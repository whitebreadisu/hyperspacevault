variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "swu-sandbox"
}

variable "region" {
  description = "Default GCP region for resources"
  type        = string
  default     = "us-central1"
}
