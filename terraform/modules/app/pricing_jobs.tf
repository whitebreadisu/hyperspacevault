# BL-139: Cloud Scheduler -> Cloud Run Job infra for the two BL-136 P2/P3
# pricing jobs (Definition_Pricing_2026-07-16.md §3). PR #335 (BL-136 P1-P4)
# shipped both jobs' Python entrypoints (app.jobs.price_sync,
# app.jobs.price_backfill) but explicitly left this wiring out -- "grepped
# terraform/ for an existing scheduled-job pattern to copy; none exists" --
# so this is new terraform, not a copy of prior art.
#
# Both google_cloud_run_v2_job resources reuse the backend service's own
# image (local.backend_image, cloud_run.tf) and runtime service account
# (backend_runtime -- already has cloudsql.client + the DATABASE_URL/
# APP_DATABASE_URL secret grants the job needs, since app/database.py reads
# both env vars unconditionally at import time regardless of which entrypoint
# runs). Applied via the module, so BOTH dev and prod get the same daily
# scheduler + both jobs (posture flagged in the PR description: dev syncing
# prices daily has no real cost -- Cloud Scheduler is ~free at this volume --
# but isn't strictly necessary for a traffic-less environment; kept
# symmetric with prod rather than inventing a dev-only skip).

data "google_project" "app" {
  project_id = var.project_id
}

# Daily sync job (P2): `python -m app.jobs.price_sync`. No default args --
# the module is watermark-gated and idempotent on its own (tcgcsv.com's
# last-updated.txt), so a bare run is always the right thing to do.
resource "google_cloud_run_v2_job" "price_sync" {
  name                = "price-sync"
  location            = var.region
  deletion_protection = false # stateless job definition; all real state lives in Postgres

  template {
    template {
      service_account = google_service_account.backend_runtime.email
      max_retries     = 1
      # tcgcsv fetch + upsert of ~7-9k rows across 10 root-set groups,
      # sequential + throttled (>=100ms/request) by design -- comfortably
      # under a minute in practice, generous ceiling for a slow tcgcsv day.
      timeout = "600s"

      containers {
        image   = local.backend_image
        command = ["python"]
        args    = ["-m", "app.jobs.price_sync"]

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
          name = "APP_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app_database_url.secret_id
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
    google_project_service.bl139,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.app_database_url,
  ]
}

# One-time history backfill job (P3): `python -m app.jobs.price_backfill`.
# Deliberately NOT wired to Cloud Scheduler -- the brief requires this to
# run once, from GCP, throttled (>=1s between archive downloads), never
# through the owner's uplink and never as an unattended recurring job. The
# default args below are an inert single already-processed day (a bare
# `gcloud run jobs execute price-backfill` with no override is a safe no-op
# once the watermark has passed it) -- the real invocation always overrides
# --start/--end explicitly:
#   gcloud run jobs execute price-backfill --region=<region> \
#     --args="-m,app.jobs.price_backfill,--end,2026-07-20"
resource "google_cloud_run_v2_job" "price_backfill" {
  name                = "price-backfill"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.backend_runtime.email
      max_retries     = 0 # restartable via its own watermark -- a blind retry would just redo the last (uncommitted) day, not skip ahead
      # Was 3600s on the ">=1s/day" estimate; real dev throughput measured
      # ~8-10s/day (py7zr-dominated), so execution ddkz4 (2026-07-21) was
      # timeout-killed mid-range after ~195 days -- the watermark held, no
      # data loss, but multi-hundred-day ranges need one execution to span
      # hours. 6h clears the full ~860-day worst case (~2.5h measured-rate)
      # with margin; Cloud Run Jobs' hard ceiling is 24h.
      timeout = "21600s"

      containers {
        image   = local.backend_image
        command = ["python"]
        args    = ["-m", "app.jobs.price_backfill", "--end", "2024-03-08"]

        # BL-139: discovered via live dev executions (2026-07-21). The
        # default Cloud Run Jobs memory ceiling (512Mi) OOM-killed the
        # container on the FIRST archive; a follow-up bump to 2Gi cleared
        # days 1-2 but OOM-killed on day 3 (prices-2024-03-10.ppmd.7z) --
        # not a slow leak (each day is a fresh `with py7zr.SevenZipFile(...)`
        # block), but per-archive peak usage that varies day to day and
        # sits right at the edge of 2Gi. Each daily archive
        # (tcgcsv.com/archive/tcgplayer/prices-{date}.ppmd.7z) is every
        # TCGplayer category's prices for that day, not just SWU's category
        # 79 -- PPMd is a memory-hungry compression scheme, and py7zr has to
        # open/index the whole archive before it can selectively extract our
        # handful of entries, at a cost that swings archive-to-archive well
        # past our ~9k-row SWU-only slice. 4Gi (paired with 2 vCPU -- Cloud
        # Run requires >=2 CPU once memory exceeds 4GiB territory) took a
        # real 87-day range (2024-03-08..2024-06-02, 80,798 rows, 0 archive
        # gaps) through clean with no further OOM -- that run was eventually
        # interrupted by an unrelated infra event (a CI apply against main,
        # which didn't yet have this file, tore the job down mid-execution),
        # not by memory pressure.
        resources {
          limits = {
            cpu    = "2"
            memory = "4Gi"
          }
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
          name = "APP_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app_database_url.secret_id
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
    google_project_service.bl139,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.app_database_url,
  ]
}

# Dedicated identity for Cloud Scheduler's OIDC/OAuth call into the Cloud Run
# Admin API's `:run` action -- kept separate from backend_runtime (which is
# the job's own execution identity, not its invoker) so the invoke grant is
# scoped to exactly one permission (run.invoker on one job), not bundled onto
# an identity that also holds cloudsql.client + secret access.
resource "google_service_account" "pricing_scheduler_invoker" {
  account_id   = "pricing-scheduler-invoker"
  display_name = "Pricing Scheduler Invoker"
  description  = "Identity Cloud Scheduler uses to invoke the daily price-sync Cloud Run Job."
}

resource "google_cloud_run_v2_job_iam_member" "price_sync_invoker" {
  project  = google_cloud_run_v2_job.price_sync.project
  location = google_cloud_run_v2_job.price_sync.location
  name     = google_cloud_run_v2_job.price_sync.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pricing_scheduler_invoker.email}"
}

# Cloud Scheduler's own service agent needs to be able to mint a token AS
# pricing_scheduler_invoker before it can present that identity to Cloud Run
# -- without this grant, job creation succeeds but every scheduled run fails
# with a permission-denied on token creation, not on the invoke itself
# (a real, easy-to-miss gotcha with this pattern).
resource "google_service_account_iam_member" "scheduler_can_impersonate_invoker" {
  service_account_id = google_service_account.pricing_scheduler_invoker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.app.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}

# Daily trigger, ~20:30 UTC -- "after ~20:00 UTC" per the definition package
# (tcgcsv's own daily build finishes before then per the spike). The job
# itself no-ops (self-correcting) if tcgcsv's build is running late that day.
resource "google_cloud_scheduler_job" "price_sync_daily" {
  name      = "price-sync-daily"
  region    = var.region
  schedule  = "30 20 * * *"
  time_zone = "UTC"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.price_sync.name}:run"

    oauth_token {
      service_account_email = google_service_account.pricing_scheduler_invoker.email
    }
  }

  depends_on = [
    google_project_service.bl139,
    google_cloud_run_v2_job_iam_member.price_sync_invoker,
    google_service_account_iam_member.scheduler_can_impersonate_invoker,
  ]
}
