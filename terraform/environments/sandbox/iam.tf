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
  ]
}

resource "google_project_iam_member" "terraform_ci" {
  for_each = toset(local.terraform_ci_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.terraform_ci.email}"
}
