output "project_id" {
  value = var.project_id
}

output "enabled_apis" {
  value = [for s in google_project_service.baseline : s.service]
}

output "terraform_ci_service_account" {
  value = google_service_account.terraform_ci.email
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "backend_repository_url" {
  description = "Base path for backend image tags, e.g. <this>/api:<tag>"
  value       = module.app.backend_repository_url
}

output "cloud_sql_connection_name" {
  value = module.app.cloud_sql_connection_name
}

output "backend_url" {
  value = module.app.backend_url
}

output "custom_domain_required_dns_updates" {
  description = "DNS records Firebase needs for the swu.jeremybradenapps.com custom domain (TXT verification, A/AAAA hosting). Add these to jeremy-portfolio's dns.tf."
  value       = google_firebase_hosting_custom_domain.swu_subdomain.required_dns_updates
}

output "custom_domain_state" {
  description = "Ownership and hosting state of the swu.jeremybradenapps.com custom domain"
  value = {
    ownership_state = google_firebase_hosting_custom_domain.swu_subdomain.ownership_state
    host_state      = google_firebase_hosting_custom_domain.swu_subdomain.host_state
  }
}

output "hyperspacevault_name_servers" {
  description = "Cloud DNS nameservers for hyperspacevault.com (BL-127) — set these as Custom DNS on the domain at Namecheap."
  value       = google_dns_managed_zone.hyperspacevault.name_servers
}

output "hyperspacevault_required_dns_updates" {
  description = "DNS records Firebase needs for www/apex hyperspacevault.com (TXT ownership verification, then A/AAAA). Add them to the hyperspacevault zone in THIS project via a follow-up PR, then re-apply."
  value = {
    www  = google_firebase_hosting_custom_domain.hyperspacevault_www.required_dns_updates
    apex = google_firebase_hosting_custom_domain.hyperspacevault_apex.required_dns_updates
  }
}

output "hyperspacevault_domain_state" {
  description = "Ownership and hosting state of the hyperspacevault.com custom domains"
  value = {
    www_ownership_state  = google_firebase_hosting_custom_domain.hyperspacevault_www.ownership_state
    www_host_state       = google_firebase_hosting_custom_domain.hyperspacevault_www.host_state
    apex_ownership_state = google_firebase_hosting_custom_domain.hyperspacevault_apex.ownership_state
    apex_host_state      = google_firebase_hosting_custom_domain.hyperspacevault_apex.host_state
  }
}

output "firebase_web_app_api_key" {
  description = "Firebase Web App API key (P5 stage 4 prerequisite), passed to the frontend build as VITE_FIREBASE_API_KEY."
  value       = module.app.firebase_web_app_api_key
}

output "firebase_web_app_auth_domain" {
  description = "Firebase Web App auth domain (P5 stage 4 prerequisite), passed to the frontend build as VITE_FIREBASE_AUTH_DOMAIN."
  value       = module.app.firebase_web_app_auth_domain
}

output "card_images_bucket_name" {
  description = "Per-env GCS bucket for self-hosted card images (BL-76 Phase 1). Phase 2's mirror/backfill script consumes this."
  value       = module.app.card_images_bucket_name
}
