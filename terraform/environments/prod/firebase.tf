# Resources moved to terraform/modules/app/firebase.tf (BL-43 Phase 2).
# google_firebase_project.default          -> module.app.google_firebase_project.default
# google_firebase_web_app.default          -> module.app.google_firebase_web_app.default
# data.google_firebase_web_app_config.default -> module.app (data source; no moved block needed)
# See moved.tf for the state-address migration blocks.
