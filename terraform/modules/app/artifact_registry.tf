resource "google_artifact_registry_repository" "backend" {
  repository_id = "backend"
  location      = var.region
  format        = "DOCKER"
  description   = "Container images for the SWU Inventory Manager FastAPI backend."

  depends_on = [google_project_service.p2]
}
