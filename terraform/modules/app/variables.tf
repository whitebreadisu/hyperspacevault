variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "Default GCP region for resources"
  type        = string
}

variable "backend_image_tag" {
  description = "Tag of the backend image (in Artifact Registry) to deploy to Cloud Run."
  type        = string
}

variable "sql_instance_name" {
  description = "Cloud SQL instance name. Differs per environment (e.g. swu-prod-pg vs swu-dev-pg)."
  type        = string
}

variable "sql_tier" {
  description = "Cloud SQL instance machine tier."
  type        = string
  default     = "db-f1-micro"
}

variable "sql_max_connections" {
  description = <<-EOT
    Effective max_connections for this environment's sql_tier, used only to
    compute the connections-saturation alert threshold in monitoring.tf
    (BL-156). No databaseFlags are set on the instance (database.tf), so
    max_connections is whatever the tier's default happens to be -- Terraform
    has no way to read that back, so this must be kept in sync by hand with
    sql_tier: db-f1-micro defaults to 25 (this module's default, matching
    both envs today), db-g1-small defaults to 50. When a caller changes
    sql_tier, it must also update this value in the same PR.
  EOT
  type        = number
  default     = 25
}

variable "deletion_protection" {
  description = "Whether to enable deletion protection on the Cloud SQL instance. Set to false for non-prod environments."
  type        = bool
  default     = true
}

variable "environment_name" {
  description = "Environment label passed to Cloud Run as the ENVIRONMENT env var (e.g. 'production', 'development')."
  type        = string
  default     = "production"
}

variable "notification_email" {
  description = "Email address for the Cloud Monitoring alert notification channel."
  type        = string
}

variable "notification_channel_display_name" {
  description = "Display name for the Cloud Monitoring email notification channel."
  type        = string
}

variable "max_instance_count" {
  description = <<-EOT
    Ceiling on concurrent Cloud Run instances for the backend service (RR-2 / finding F14).
    The backend has anonymous, unauthenticated read endpoints; without a cap, a request
    flood could scale Cloud Run out unboundedly and drive up billing. Each instance defaults
    to handling ~80 concurrent requests, so even a small cap comfortably covers realistic
    load while bounding worst-case cost. No module default is set deliberately — every env
    caller must pass an explicit value so the tradeoff is a visible, per-environment decision.
  EOT
  type        = number
}

variable "feedback_github_repo" {
  description = <<-EOT
    BL-126: the private GitHub repo (owner/repo) POST /api/feedback creates a
    notification issue in, via the feedback-github-pat secret (secrets.tf). Every
    environment defaults to the same single repo Jeremy manages by hand (issue #289)
    -- unlike sql_instance_name/environment_name, this isn't expected to actually
    differ per environment, but stays a variable (not hardcoded in cloud_run.tf)
    so a future environment could point elsewhere without a module change.
  EOT
  type        = string
  default     = "whitebreadisu/swu-feedback"
}
