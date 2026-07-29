locals {
  # APIs needed for P2 (Production Deploy), enabled together since all three
  # stages of this phase happen in the same session.
  p2_apis = [
    "artifactregistry.googleapis.com", # container image repo (stage 1)
    "sqladmin.googleapis.com",         # Cloud SQL Admin API (stage 2)
    "secretmanager.googleapis.com",    # DB password storage (stage 2)
    "run.googleapis.com",              # Cloud Run service (stage 3)
  ]
}

resource "google_project_service" "p2" {
  for_each = toset(local.p2_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

locals {
  # APIs needed for P2 stage 4 (static frontend hosting), a separate session
  # from the other three P2 stages.
  p2_stage4_apis = [
    "firebase.googleapis.com",        # enables Firebase on this GCP project
    "firebasehosting.googleapis.com", # Hosting-specific API
  ]
}

resource "google_project_service" "p2_stage4" {
  for_each = toset(local.p2_stage4_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

locals {
  # APIs needed for P5 stage 1: Firebase Authentication is backed by the
  # Identity Platform / Identity Toolkit API.
  p5_apis = [
    "identitytoolkit.googleapis.com",
  ]
}

resource "google_project_service" "p5" {
  for_each = toset(local.p5_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

locals {
  # RR-11: Artifact Registry vulnerability scanning. Every image pushed to AR
  # is scanned on push and continuously re-checked as new CVEs publish;
  # results surface in the AR console per image digest. Triage folds into the
  # existing Dependabot cadence (Platform Spec §5).
  rr11_apis = [
    "containerscanning.googleapis.com",
  ]
}

resource "google_project_service" "rr11" {
  for_each = toset(local.rr11_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

locals {
  # APIs needed for P6: Cloud Monitoring dashboards (stage 2), alerting
  # (stage 3), and Error Reporting (stage 4). monitoring.googleapis.com is
  # already enabled (a Cloud Run dependency) -- declaring it here brings it
  # under Terraform management, same reasoning as the other phases' API lists.
  # clouderrorreporting.googleapis.com is the only stage 4 change -- error
  # groups are derived from Stage 1's existing structured logs, no new
  # resources to create.
  p6_apis = [
    "monitoring.googleapis.com",
    "clouderrorreporting.googleapis.com",
  ]
}

resource "google_project_service" "p6" {
  for_each = toset(local.p6_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

locals {
  # BL-139: Cloud Scheduler drives the daily tcgcsv price-sync Cloud Run Job
  # (pricing_jobs.tf). run.googleapis.com is already enabled (p2_apis, the
  # Cloud Run *service*) -- Cloud Run *Jobs* live under the same API, so no
  # separate "jobs" API exists to enable.
  bl139_apis = [
    "cloudscheduler.googleapis.com",
  ]
}

resource "google_project_service" "bl139" {
  for_each = toset(local.bl139_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}
