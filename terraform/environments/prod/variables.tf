variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "swu-prod"
}

variable "region" {
  description = "Default GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "backend_image_tag" {
  description = "Tag of the backend image (in the Artifact Registry repo) to deploy to Cloud Run."
  type        = string
  # CI's `deploy` job always overrides this via `-var="backend_image_tag=${{ github.sha }}"`.
  # The default only matters for a local `terraform apply` (e.g. an IAM grant)
  # run without that flag — keep it pointed at a recently-deployed SHA so a
  # local apply doesn't silently roll Cloud Run back to a stale image.
  default = "a251ecff73eec310a87d6d87daa572eea1e406da"
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
