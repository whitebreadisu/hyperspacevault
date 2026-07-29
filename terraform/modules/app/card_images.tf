# BL-76 Phase 1 (ADR-0012): per-environment GCS bucket for self-hosted card
# images. Not publicly readable -- Phase 3 serves images same-origin via a
# Firebase Hosting rewrite to a thin Cloud Run handler that reads objects
# using its own runtime identity; browsers never talk to GCS directly.
# Objects are immutable by convention (a changed image gets a new path), so
# no lifecycle rules and no versioning.
resource "google_storage_bucket" "card_images" {
  name     = "${var.project_id}-card-images"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true
  force_destroy               = false
}

# Serving identity: whatever runs the Cloud Run image handler needs read-only
# access. Phase 3 hasn't built the handler yet and may run it as this same
# backend service or a new one -- granting the existing backend_runtime SA
# now is forward-compatible either way and keeps this scoped to the one
# runtime identity that exists today.
resource "google_storage_bucket_iam_member" "card_images_backend_runtime_viewer" {
  bucket = google_storage_bucket.card_images.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.backend_runtime.email}"
}
