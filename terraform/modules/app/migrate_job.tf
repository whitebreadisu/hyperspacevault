# ADR-0011 / BL-8: `alembic upgrade head` as a discrete per-environment
# deploy step instead of running on every serving-container cold start
# (backend/Dockerfile's CMD, pre-ADR-0011). Same shape as pricing_jobs.tf's
# Cloud Run Jobs: reuses the backend service's own image (local.backend_image,
# cloud_run.tf) and runtime service account (backend_runtime -- already holds
# cloudsql.client + the DATABASE_URL secret grant this job needs).
#
# CI drives the sequencing (not this file): before each environment's full
# `terraform apply` (which deploys the new backend service revision), CI runs
# a *targeted* apply of just this resource
# (`-target=module.app.google_cloud_run_v2_job.migrate`) at the new image
# tag, then `gcloud run jobs execute migrate --wait` and fails the pipeline
# on a non-zero exit -- migrations run once, before the new revision takes
# traffic, and a failed migration fails the deploy step while the current
# revision keeps serving (see ci.yml's deploy-dev job and
# .github/actions/promote-prod/action.yml).
#
# Runs as `swu_user` (DATABASE_URL) -- the migration-running role -- not
# `swu_app` (APP_DATABASE_URL, the request-serving role); see Platform Spec
# §1.7.2 for the role split. Only DATABASE_URL is wired here (alembic/env.py
# reads exactly that one env var; APP_DATABASE_URL is a serving-container-only
# concern this job has no use for).
resource "google_cloud_run_v2_job" "migrate" {
  name                = "migrate"
  location            = var.region
  deletion_protection = false # stateless job definition; all real state lives in Postgres

  template {
    template {
      service_account = google_service_account.backend_runtime.email
      # max_retries = 0 (not the Cloud Run Jobs default): a migration failure
      # should surface immediately to the CI step that's waiting on this
      # execution, not get silently retried by Cloud Run in the background --
      # ADR-0011's whole point is a failed migration failing the *deploy step*
      # in an observable way, not masking a real problem behind a retry.
      max_retries = 0
      # Generous relative to real migration runtime (schema-change DDL,
      # typically sub-minute) -- matches the ceiling the same command
      # implicitly ran under as part of Cloud Run's container-start timeout
      # before this change, with margin.
      timeout = "600s"

      containers {
        image   = local.backend_image
        command = ["alembic"]
        args    = ["upgrade", "head"]

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
    }
  }

  depends_on = [
    google_project_service.p2,
    google_secret_manager_secret_version.database_url,
  ]
}
