resource "google_service_account" "backend_runtime" {
  account_id   = "backend-runtime"
  display_name = "Backend Runtime"
  description  = "Identity used by the Cloud Run backend service at runtime (Cloud SQL connection, secret access)."
  # Note: depends_on [google_project_service.baseline] is handled at the
  # module call site via the prod env's dependency on the baseline APIs.
}

resource "google_project_iam_member" "backend_runtime_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.backend_runtime.email}"
}

# BL-139: the same built-and-pushed backend image also runs the pricing
# Cloud Run Jobs (pricing_jobs.tf) -- one artifact, two deploy shapes
# (long-running service vs. one-shot job), same pattern Cloud Run itself is
# built around. Hoisted to a local so the image reference isn't duplicated
# (and risking drift) across cloud_run.tf and pricing_jobs.tf.
locals {
  backend_image = "${google_artifact_registry_repository.backend.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.backend.repository_id}/api:${var.backend_image_tag}"
}

resource "google_cloud_run_v2_service" "backend" {
  name     = "backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # Wired to the env's deletion_protection (prod default true = no prod change;
  # dev passes false so a disposable env can be torn down). Added 2026-06-27
  # (BL-43 Phase 3) — see #69.
  deletion_protection = var.deletion_protection

  template {
    service_account = google_service_account.backend_runtime.email

    # Caps worst-case cost exposure from anonymous-endpoint abuse (RR-2 / finding
    # F14). See var.max_instance_count for rationale; value is set per-env by the
    # module caller (dev = 1, prod = 3).
    scaling {
      max_instance_count = var.max_instance_count
    }

    containers {
      image = local.backend_image

      ports {
        # Matches the Dockerfile's hardcoded `uvicorn --port 8000`.
        container_port = 8000
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "APP_DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app_db_password.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "APP_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app_database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "ENVIRONMENT"
        value = var.environment_name
      }

      # BL-76 Phase 3 (ADR-0012): the same-origin image handler
      # (app/routers/images.py) reads this to resolve the per-env bucket
      # Phase 1 created (card_images.tf) -- the backend_runtime SA already
      # has objectViewer on it from that same phase.
      env {
        name  = "CARD_IMAGES_BUCKET"
        value = google_storage_bucket.card_images.name
      }

      # BL-126: no COMMIT_SHA env var existed anywhere in this codebase
      # before this slice (confirmed by grep across backend/, Dockerfile,
      # and .github/workflows/ during the build). var.backend_image_tag is
      # already the deploying commit's github.sha (CI's `deploy` job
      # overrides it via -var, see environments/*/variables.tf) and it's
      # already threaded into this same container block as the image tag
      # above -- reusing it here means the backend can attach its own
      # commit_sha to a feedback submission (owner decision #4, server-side
      # metadata only) with no new CI wiring. Unset in local/CI test runs,
      # where app/services/feedback.py reads it as None via os.environ.get.
      env {
        name  = "COMMIT_SHA"
        value = var.backend_image_tag
      }

      # BL-126: best-effort GitHub-issue notification on feedback
      # submission (app/services/github_notify.py). The secret's real
      # value is added out-of-band by Jeremy, not by this terraform config
      # -- see secrets.tf's feedback_github_pat resources for why a
      # placeholder version still has to exist here.
      env {
        name = "FEEDBACK_GITHUB_PAT"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.feedback_github_pat.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "FEEDBACK_GITHUB_REPO"
        value = var.feedback_github_repo
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

  # Cloud Run reads these secrets via `versions/latest`; that reference does not
  # create a Terraform dependency on the *version* resources, so on a clean
  # from-scratch apply Cloud Run can deploy before the versions exist
  # ("Secret .../versions/latest was not found"). Explicit depends_on fixes the
  # ordering. (Surfaced by the BL-43 dev environment's first clean apply, 2026-06-27;
  # prod never hit it because it was built incrementally. depends_on is ordering-only,
  # so prod's plan stays 0/0/0.)
  depends_on = [
    google_project_service.p2,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.app_db_password,
    google_secret_manager_secret_version.app_database_url,
    google_secret_manager_secret_version.feedback_github_pat,
  ]
}

# Required for "It's alive" (P2 milestone): the API has no auth in front of
# it yet (auth is P5), so this makes it reachable on the public internet.
resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  project  = google_cloud_run_v2_service.backend.project
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
