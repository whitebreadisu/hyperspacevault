output "backend_repository_url" {
  description = "Base path for backend image tags, e.g. <this>/api:<tag>"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.backend.repository_id}"
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "backend_url" {
  value = google_cloud_run_v2_service.backend.uri
}

output "firebase_web_app_api_key" {
  description = "Firebase Web App API key, passed to the frontend build as VITE_FIREBASE_API_KEY."
  value       = data.google_firebase_web_app_config.default.api_key
}

output "firebase_web_app_auth_domain" {
  description = "Firebase Web App auth domain, passed to the frontend build as VITE_FIREBASE_AUTH_DOMAIN. BL-211: env configs override this to their own Hosting domain so the auth handler is same-origin (see var.auth_domain_override)."
  value       = var.auth_domain_override != "" ? var.auth_domain_override : data.google_firebase_web_app_config.default.auth_domain
}

output "card_images_bucket_name" {
  description = "Name of the per-env GCS bucket for self-hosted card images (BL-76 Phase 1 / ADR-0012). Phase 2's mirror/backfill script consumes this."
  value       = google_storage_bucket.card_images.name
}

output "repo_assets_bucket_name" {
  description = "Name of the per-env GCS bucket holding FFG-sourced material offloaded from the repo (BL-170). CI build-time pulls and the content runbook's upload step consume this."
  value       = google_storage_bucket.repo_assets.name
}

output "notification_channel_id" {
  description = "ID of the module's email notification channel (monitoring.tf), for per-environment alert resources defined outside the module -- e.g. the prod-only custom-domain uptime check (BL-156)."
  value       = google_monitoring_notification_channel.email.id
}
