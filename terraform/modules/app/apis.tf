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

# Artifact Registry's paid on-push scanning stays OFF in this project; image
# scanning is Trivy in GitHub Actions instead (ADR-0038, Platform Spec §5.1
# A06). The API was disabled by hand in both projects on 2026-11-02, so this
# resource is a guard, not the switch: google_project_service cannot declare
# an API disabled (dropping a resource whose state holds
# disable_on_destroy = false only forgets it).
#
# On create (once per project) it reads whether containerscanning is enabled
# and, only if it is, tries to disable it. It never fails the apply: an
# unreadable state or a refused disable prints a WARNING and exits 0, and
# on_failure = continue covers anything else. No --force, so a dependent
# service is never disabled with it. image-scan-prod.yml goes red daily while
# the API is enabled in prod. containeranalysis (the free metadata API
# containerscanning depends on) is left as it is.
#
# Needs bash and gcloud on PATH with the applying identity's credentials:
# both CI apply paths run setup-gcloud after WIF auth on ubuntu runners, and
# terraform-ci holds serviceusage.serviceUsageAdmin in both projects.
resource "terraform_data" "containerscanning_disabled" {
  triggers_replace = [var.project_id, "containerscanning.googleapis.com"]

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    on_failure  = continue
    command     = <<-EOT
      api=containerscanning.googleapis.com
      project=${var.project_id}
      if ! enabled=$(gcloud services list --enabled --project="$project" --filter="config.name=$api" --format="value(config.name)"); then
        echo "WARNING: could not read enabled services in $project; $api state unknown (ADR-0038)"
        exit 0
      fi
      if [ -z "$enabled" ]; then
        echo "$api is disabled in $project"
        exit 0
      fi
      if gcloud services disable "$api" --project="$project" --quiet; then
        echo "$api disabled in $project"
      else
        echo "WARNING: disabling $api in $project was refused; it is still enabled and billing (ADR-0038)"
      fi
      exit 0
    EOT
  }
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
