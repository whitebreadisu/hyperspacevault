data "google_project" "this" {
  project_id = var.project_id
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Pool for OIDC tokens issued by GitHub Actions runs of whitebreadisu/SWU-Inventory-Manager."

  depends_on = [google_project_service.baseline]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # Belt-and-suspenders with the principalSet condition below: only tokens
  # asserting this exact repo are accepted by the provider at all.
  attribute_condition = "assertion.repository == 'whitebreadisu/SWU-Inventory-Manager'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Lets any workflow run in whitebreadisu/SWU-Inventory-Manager impersonate
# terraform-ci via its short-lived OIDC token (no key files).
resource "google_service_account_iam_member" "terraform_ci_wif" {
  service_account_id = google_service_account.terraform_ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/attribute.repository/whitebreadisu/SWU-Inventory-Manager"
}
