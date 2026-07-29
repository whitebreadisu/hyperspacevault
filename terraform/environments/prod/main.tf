locals {
  baseline_apis = [
    "storage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
  ]
}

resource "google_project_service" "baseline" {
  for_each = toset(local.baseline_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

module "app" {
  source = "../../modules/app"

  project_id        = var.project_id
  region            = var.region
  backend_image_tag = var.backend_image_tag
  sql_instance_name = "swu-prod-pg"
  # BL-150 decision D4 (2026-07-24 owner triage, Definition_Steadying_2026-07-24.md
  # §2): prod Cloud SQL -> db-g1-small, +~$18/mo. A5-05 found prod's db-f1-micro
  # memory pinned at a constant 100% (incl. OS page cache -- see monitoring.tf's
  # sql_memory_saturation comment); g1-small's ~3x memory (1.7GB) buys real
  # page-cache headroom, and its max_connections default rises 25 -> 50, which
  # A5-06 flagged as the tier half of defusing the pool-math latent outage (the
  # SQLAlchemy pool caps, D2, are the other half and land independently). Set
  # explicitly here rather than bumping the module default (variables.tf:21-25)
  # because dev deliberately stays on db-f1-micro -- this is a real per-env
  # difference, not a default drifting stale. Changing settings.tier on an
  # existing Cloud SQL instance is in-place (no replacement) but does cause a
  # brief instance restart; this apply rides the owner-gated prod promote, not
  # an automatic merge-to-dev deploy.
  sql_tier                          = "db-g1-small"
  notification_email                = var.notification_email
  notification_channel_display_name = "Jeremy (primary)"
  max_instance_count                = 3 # RR-2: bounds worst-case cost of anonymous-endpoint abuse
  # deletion_protection and environment_name use module defaults (true,
  # "production"), which match the prod configuration.

  providers = {
    google      = google
    google-beta = google-beta
  }
}
