terraform {
  backend "gcs" {
    bucket = "swu-sandbox-tfstate"
    prefix = "terraform/state"
  }
}
