terraform {
  backend "gcs" {
    bucket = "swu-prod-tfstate"
    prefix = "terraform/state"
  }
}
