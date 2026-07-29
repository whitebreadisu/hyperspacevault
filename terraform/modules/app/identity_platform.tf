# Enables Firebase Authentication's Email/Password sign-in provider on the
# Firebase project. This is the managed identity provider the backend builds
# on -- see Roadmap Section 5 and SWU_Platform_Learning_Guide.md's P5 chapter.
resource "google_identity_platform_config" "default" {
  provider = google-beta
  project  = var.project_id

  sign_in {
    email {
      enabled           = true
      password_required = true
    }

    # GCP enables the phone provider in a disabled state by default; declare it
    # here to match the API-returned state and prevent perpetual plan diffs.
    phone_number {
      enabled            = false
      test_phone_numbers = {}
    }
  }

  depends_on = [google_project_service.p5, google_firebase_project.default]
}
