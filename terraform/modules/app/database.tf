resource "google_sql_database_instance" "main" {
  name             = var.sql_instance_name
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"

    backup_configuration {
      enabled = true
      # RR-7 (BL-21): point-in-time recovery — continuous WAL archiving on
      # top of the daily backup, so a restore can target any minute in the
      # retention window instead of "last midnight" (RPO drops from ≤24h to
      # ~minutes). In-place setting; verified via plan that it does not
      # recreate the instance. The restore drill that validates this is
      # tracked in BL-21 (needs Jeremy present — prod data access).
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
    }

    ip_configuration {
      # Public IP, but no authorized networks: Cloud Run reaches this
      # instance via the IAM-authenticated Cloud SQL Auth Proxy, not a
      # network-level allow-list.
      ipv4_enabled = true
    }
  }

  deletion_protection = var.deletion_protection

  depends_on = [google_project_service.p2]
}

resource "google_sql_database" "inventory" {
  name     = "swu_inventory"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "swu_user"
  instance = google_sql_database_instance.main.name
  password = random_password.db_password.result
}
