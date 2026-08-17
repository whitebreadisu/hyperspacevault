resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "db-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.p2]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "database-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.p2]
}

# Full DSN for the Cloud Run backend, using the Cloud SQL Unix socket path
# (Cloud Run's native Cloud SQL volume mount, not the Auth Proxy used for the
# Stage 2 data load).
resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://${google_sql_user.app.name}:${random_password.db_password.result}@/${google_sql_database.inventory.name}?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
}

resource "google_secret_manager_secret_iam_member" "backend_runtime_database_url" {
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend_runtime.email}"
}

# P4 Stage 2: password for the swu_app role created by migration 0019.
# alembic upgrade head (run by the discrete migrate Cloud Run Job before
# each deploy takes traffic -- ADR-0011; NOT on container start) reads this
# so it can CREATE ROLE swu_app. Also used below (Stage 3) to build
# APP_DATABASE_URL, the request-serving connection string.
resource "random_password" "app_db_password" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "app_db_password" {
  secret_id = "app-db-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.p2]
}

resource "google_secret_manager_secret_version" "app_db_password" {
  secret      = google_secret_manager_secret.app_db_password.id
  secret_data = random_password.app_db_password.result
}

resource "google_secret_manager_secret_iam_member" "backend_runtime_app_db_password" {
  secret_id = google_secret_manager_secret.app_db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend_runtime.email}"
}

# P4 Stage 3: connection string for swu_app, the RLS-aware role migration
# 0019 creates. app/database.py reads APP_DATABASE_URL to build the
# request-serving (Depends(get_db)) connection -- swu_user/DATABASE_URL
# above remains the migration-running admin connection.
resource "google_secret_manager_secret" "app_database_url" {
  secret_id = "app-database-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.p2]
}

resource "google_secret_manager_secret_version" "app_database_url" {
  secret      = google_secret_manager_secret.app_database_url.id
  secret_data = "postgresql://swu_app:${random_password.app_db_password.result}@/${google_sql_database.inventory.name}?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
}

resource "google_secret_manager_secret_iam_member" "backend_runtime_app_database_url" {
  secret_id = google_secret_manager_secret.app_database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend_runtime.email}"
}

# BL-126: fine-grained PAT (Issues r/w, feedback_github_repo only) the
# backend uses for its best-effort GitHub-issue notification on every
# feedback submission (app/services/github_notify.py).
#
# UNLIKE every other secret in this file, the real token value is
# deliberately NOT terraform-managed -- Jeremy creates the PAT by hand on
# GitHub (issue #289's manual prerequisite) and adds it as a secret version
# out-of-band via gcloud (see this PR's description for the exact command
# per environment), so it never enters terraform state or a plan/apply
# diff. That leaves a bootstrapping problem: Cloud Run's env block below
# reads this secret at `version = "latest"`, and (per cloud_run.tf's own
# comment on the existing DB secrets) a Cloud Run deploy fails outright if
# `versions/latest` doesn't exist yet -- there would be no version at all
# on a clean environment until Jeremy's manual step runs. This resource
# creates a PLACEHOLDER version so `versions/latest` always resolves to
# *something* deployable; once Jeremy adds a real version out-of-band,
# `versions/latest` picks that newer version instead (Secret Manager
# versions are immutable and monotonically ordered, so a later add always
# wins over this one). app/services/github_notify.py treats the literal
# placeholder value exactly like a missing token -- an ordinary best-effort
# notification skip, never an error surfaced to the submitter.
resource "google_secret_manager_secret" "feedback_github_pat" {
  secret_id = "feedback-github-pat"

  replication {
    auto {}
  }

  depends_on = [google_project_service.p2]
}

resource "google_secret_manager_secret_version" "feedback_github_pat" {
  secret      = google_secret_manager_secret.feedback_github_pat.id
  secret_data = "PLACEHOLDER_ROTATE_ME"

  # Once Jeremy adds the real token out-of-band, terraform would otherwise
  # want to "fix" the secret back to this placeholder on the next apply --
  # ignore_changes stops that: this resource's only job is guaranteeing a
  # version exists at all, not owning its value long-term.
  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "backend_runtime_feedback_github_pat" {
  secret_id = google_secret_manager_secret.feedback_github_pat.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend_runtime.email}"
}
