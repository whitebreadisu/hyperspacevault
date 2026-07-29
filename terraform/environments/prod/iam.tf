resource "google_service_account" "terraform_ci" {
  account_id   = "terraform-ci"
  display_name = "Terraform CI"
  description  = "Identity used by GitHub Actions (via Workload Identity Federation, P1 stage 4) to apply Terraform changes."

  depends_on = [google_project_service.baseline]
}

locals {
  # Roles needed for P1 (this stage) plus the near-term P2 production deploy.
  # Scoped to concrete near-term needs rather than roles/editor; later phases
  # add to this list as new services come into play.
  terraform_ci_roles = [
    "roles/serviceusage.serviceUsageAdmin",  # enable new APIs (Cloud Run, Cloud SQL, Artifact Registry) for P2
    "roles/run.admin",                       # deploy/manage the Cloud Run service (P2)
    "roles/cloudsql.admin",                  # provision/manage the Cloud SQL instance (P2)
    "roles/artifactregistry.admin",          # manage the container image repo (P2)
    "roles/iam.serviceAccountAdmin",         # create/manage the app's runtime service account (P2)
    "roles/iam.serviceAccountUser",          # attach the runtime service account to Cloud Run (P2)
    "roles/resourcemanager.projectIamAdmin", # grant IAM bindings the above need (e.g. Cloud Run SA -> Cloud SQL Client)
    "roles/secretmanager.admin",             # grant the runtime SA access to the database-url secret (P2 stage 3)
    # P3 stage 3: `terraform apply` refreshes every resource in state, not
    # just the ones changing — terraform-ci needs read access to all of it,
    # even resources it isn't managing changes to.
    "roles/iam.workloadIdentityPoolViewer", # read wif.tf's pool (it's CI's own trust config)
    # P5 stage 4 prerequisite: firebase.viewer (read-only) is replaced by
    # firebase.admin (a superset) so terraform-ci can also create/manage
    # the google_firebase_web_app resource in firebase.tf.
    "roles/firebase.admin",
    # P3 stage 4: the new frontend-deploy job runs `firebase deploy --only
    # hosting` using this identity's credentials.
    "roles/firebasehosting.admin", # deploy frontend/dist to Firebase Hosting
    # P5 stage 1: manage the Identity Platform / Firebase Authentication
    # config (google_identity_platform_config) so `terraform apply` can
    # enable the Email/Password sign-in provider.
    "roles/firebaseauth.admin",
    # P6 stage 2: create/update the google_monitoring_dashboard resource.
    # Scoped to dashboards only -- roles/monitoring.editor would also grant
    # alert policy and uptime check management, not needed until stage 3.
    "roles/monitoring.dashboardEditor",
    # P6 stage 3: create/update the alert policy and email notification
    # channel. Two narrowly-scoped roles, same reasoning as dashboardEditor
    # above -- monitoring.editor remains broader than needed.
    "roles/monitoring.alertPolicyEditor",
    "roles/monitoring.notificationChannelEditor",
    # RR-9: create/update uptime checks -- the third narrowly-scoped
    # monitoring role, needed once RR-9 added uptime_check_config resources.
    # Surfaced as a 403 on the first RR-9 dev deploy; granted manually
    # 2026-07-09 (both envs) to avoid the apply racing IAM propagation;
    # this entry codifies it.
    "roles/monitoring.uptimeCheckConfigEditor",
    # BL-127: manage the hyperspacevault.com Cloud DNS zone + records
    # (custom_domain.tf). Surfaced as a 403 on the zone-creating promote
    # (run 29779065525, 2026-07-20); granted manually the same evening --
    # the RR-9 play, avoiding the re-promote racing IAM propagation; this
    # entry codifies it. Prod-only: dev has no DNS zone.
    "roles/dns.admin",
    # BL-139: create/manage the daily price-sync Cloud Scheduler job
    # (pricing_jobs.tf). Surfaced as a 403 on dev's deploy-dev refresh
    # (`cloudscheduler.jobs.get`, run 29796247156, 2026-07-21) once the
    # scheduler resource existed in dev state from a direct dev apply ahead
    # of this PR's merge -- granted manually in both envs the same evening
    # (the RR-9 play, avoiding a later apply racing IAM propagation); this
    # entry codifies it for prod too, ahead of prod ever applying it.
    "roles/cloudscheduler.admin",
    # BL-156: create/manage the log-based cloudsql-backup-failure metric
    # (modules/app/monitoring.tf). Surfaced as a 403 on the first #443
    # apply against dev (`logging.logMetrics.create`, run 30144912398,
    # 2026-07-25) -- granted manually in both envs before the re-land (the
    # RR-9 play, avoiding the apply racing IAM propagation); this entry
    # codifies it for prod ahead of the next promote's apply.
    "roles/logging.configWriter",
  ]
}

resource "google_project_iam_member" "terraform_ci" {
  for_each = toset(local.terraform_ci_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.terraform_ci.email}"
}

# P3 stage 3: terraform-ci runs `terraform apply` itself for the first time
# (previously only Jeremy's own credentials did), so it needs access to the
# state backend. swu-prod-tfstate was created by hand in P1, outside
# Terraform, so this is bucket-scoped rather than part of terraform_ci_roles.
# storage.admin (not objectUser): apply-time refresh of this very resource
# calls bucket getIamPolicy/setIamPolicy, not just object reads/writes.
resource "google_storage_bucket_iam_member" "terraform_ci_state" {
  bucket = "swu-prod-tfstate"
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.terraform_ci.email}"
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
# under (promote-prod frontend build, build-and-push Docker-context fetch).
# objectAdmin (not just viewer) so the same identity can also refresh
# bucket contents if a workflow ever needs to; bucket-scoped like the
# card-images grant above, not project-wide.
resource "google_storage_bucket_iam_member" "terraform_ci_repo_assets" {
  bucket = module.app.repo_assets_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.terraform_ci.email}"
}
