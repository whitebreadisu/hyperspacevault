variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "swu-dev-jbapps"
}

variable "region" {
  description = "Default GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "backend_image_tag" {
  description = "Tag of the backend image (in Artifact Registry) to deploy to Cloud Run. CI overrides this via -var with github.sha. The default keeps a local plan/apply pointed at a real deployed SHA rather than an empty string."
  type        = string
  # last image pushed to dev AR; CI always overrides via -var.
  default = "62320bbf0d944dcc42f7db42d3f5b2e9258e0b8d"
}

# BL-171: the alert-delivery address is operator-personal and stays out of
# the tracked tree. CI supplies TF_VAR_notification_email from the repo's
# Actions variable NOTIFICATION_EMAIL; local applies export the same
# TF_VAR. No default on purpose -- a missing value should fail loudly, not
# silently drop alert delivery.
variable "notification_email" {
  description = "Email address for the module's monitoring notification channel."
  type        = string
}
