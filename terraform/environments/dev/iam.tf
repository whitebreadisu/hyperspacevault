resource "google_service_account" "terraform_ci" {
  account_id   = "terraform-ci"
  display_name = "Terraform CI"
  description  = "Identity used by GitHub Actions (via Workload Identity Federation, P1 stage 4) to apply Terraform changes."

  depends_on = [google_project_service.baseline]
}

locals {
  # Roles needed for P1 (baseline) through P6. Mirrors prod's terraform_ci_roles
  # exactly -- dev exercises every role the module needs (BL-43 Phase 6).
  terraform_ci_roles = [
    # P1/P2 baseline (stood up with the project in Phase 1)
    "roles/serviceusage.serviceUsageAdmin",  # enable new APIs
    "roles/run.admin",                       # deploy/manage Cloud Run
    "roles/cloudsql.admin",                  # provision/manage Cloud SQL
    "roles/artifactregistry.admin",          # manage container image repo
    "roles/iam.serviceAccountAdmin",         # create/manage runtime SA
    "roles/iam.serviceAccountUser",          # attach runtime SA to Cloud Run
    "roles/resourcemanager.projectIamAdmin", # grant IAM bindings
    # P3: terraform-ci runs apply itself -- needs to read the WIF pool it trusts.
    "roles/iam.workloadIdentityPoolViewer",
    # P2 stage 3: manage the database-url / app-db-password secrets.
    "roles/secretmanager.admin",
    # P5 stage 4: create/manage the Firebase web app resource.
    "roles/firebase.admin",
    # P3 stage 4: deploy frontend/dist to Firebase Hosting.
    "roles/firebasehosting.admin",
    # P5 stage 1: enable Email/Password sign-in via Identity Platform config.
    "roles/firebaseauth.admin",
    # P6 stage 2: create/update the monitoring dashboard.
    "roles/monitoring.dashboardEditor",
    # P6 stage 3: create/update alert policies and notification channels.
    "roles/monitoring.alertPolicyEditor",
    "roles/monitoring.notificationChannelEditor",
    # RR-9: create/update uptime checks. P6 never needed this (no uptime
    # checks then); surfaced as a 403 on the first RR-9 deploy. Granted
    # manually 2026-07-09 (both envs) so the apply that creates the check
    # doesn't race the IAM binding/propagation; this entry codifies it.
    "roles/monitoring.uptimeCheckConfigEditor",
    # BL-139: create/manage the daily price-sync Cloud Scheduler job
    # (pricing_jobs.tf). Surfaced as a 403 on deploy-dev's refresh
    # (`cloudscheduler.jobs.get`, run 29796247156, 2026-07-21) once the
    # scheduler resource existed in state from a direct dev apply ahead of
    # this PR's merge -- granted manually the same evening (the RR-9 play,
    # avoiding the re-run racing IAM propagation); this entry codifies it.
    "roles/cloudscheduler.admin",
    # BL-156: create/manage the log-based cloudsql-backup-failure metric
    # (modules/app/monitoring.tf). Surfaced as a 403 on the first #443
    # apply (`logging.logMetrics.create`, run 30144912398, 2026-07-25) --
    # granted manually in both envs before the re-land (the RR-9 play,
    # avoiding the apply racing IAM propagation); this entry codifies it.
    "roles/logging.configWriter",
  ]
}

resource "google_project_iam_member" "terraform_ci" {
  for_each = toset(local.terraform_ci_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.terraform_ci.email}"
}

# terraform-ci must read/write the dev state bucket during CI applies.
# storage.admin (not objectUser): apply-time refresh calls bucket
# getIamPolicy/setIamPolicy, not just object reads/writes.
resource "google_storage_bucket_iam_member" "terraform_ci_state" {
  bucket = "swu-dev-jbapps-tfstate"
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.terraform_ci.email}"
}

# The build-and-push CI job authenticates as swu-prod's terraform-ci SA and
# pushes the newly built image to dev AR (re-tagged from prod's AR) in the
# same step. Granting write here keeps the push atomic and avoids a second
# auth step in the deploy-dev job (BL-43 Phase 6).
resource "google_project_iam_member" "prod_ci_dev_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:terraform-ci@swu-prod.iam.gserviceaccount.com"
}

# BL-76 Phase 1 (ADR-0012): terraform-ci is also the identity Phase 2's
# mirror/backfill script runs under (GitHub Actions WIF, same pattern as the
# deploy jobs) -- objectAdmin lets it write renditions and backfill existing
# images. Bucket-scoped like the tfstate grant above, not project-wide.
resource "google_storage_bucket_iam_member" "terraform_ci_card_images" {
  bucket = module.app.card_images_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.terraform_ci.email}"
}

# BL-170: terraform-ci is the identity the CI build-time pull steps run
# under (deploy-dev frontend build, build-and-push Docker-context fetch).
# objectAdmin (not just viewer) so the same identity can also refresh
# bucket contents if a workflow ever needs to; bucket-scoped like the
# card-images grant above, not project-wide.
resource "google_storage_bucket_iam_member" "terraform_ci_repo_assets" {
  bucket = module.app.repo_assets_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.terraform_ci.email}"
}
