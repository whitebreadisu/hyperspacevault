terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Firebase and Identity Platform resources in the app module use google-beta.
# user_project_override avoids the ADC default-quota-project mismatch seen
# with the Cloud SQL Auth Proxy (same fix as prod).
provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
}
