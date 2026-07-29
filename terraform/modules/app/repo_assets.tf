# BL-170 (Repo Public Flip): per-environment GCS bucket for FFG-sourced
# material offloaded from the repo -- swuapi export JSONs, set logos,
# starfields, rarity glyphs, aspect icons. Never publicly readable; the two
# consumers are CI (WIF as terraform-ci: build-time pulls into the frontend
# build and the backend Docker context) and the operator's content runbook
# (uploads new exports/key art here instead of committing them). Per-env
# pair rather than one shared bucket so each deploy path reads same-project
# with the WIF identity it already holds, matching the runbook's staged
# dev->prod content model. Objects are replaced-in-place on catalog refresh
# (stable names, e.g. exports/swuapi_export_current.json), so no versioning;
# no lifecycle rules -- the set is small (~35 MB) and curated.
resource "google_storage_bucket" "repo_assets" {
  name     = "${var.project_id}-repo-assets"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true
  force_destroy               = false
}
