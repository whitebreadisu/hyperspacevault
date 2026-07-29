terraform {
  backend "gcs" {
    bucket = "swu-dev-jbapps-tfstate"
    prefix = "terraform/state"
  }
}
