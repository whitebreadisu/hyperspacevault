# Stage E (jeremy-portfolio portal): maps swu.jeremybradenapps.com to this
# project's Firebase Hosting site. wait_dns_verification = false on first
# apply so Terraform doesn't block waiting for DNS records that don't exist
# yet - required_dns_updates tells us what to add to jeremy-portfolio's
# Cloud DNS zone, then we apply again.
resource "google_firebase_hosting_custom_domain" "swu_subdomain" {
  provider = google-beta
  project  = var.project_id

  site_id       = var.project_id
  custom_domain = "swu.jeremybradenapps.com"

  wait_dns_verification = false

  # google_firebase_project.default now lives inside module.app.
  depends_on = [module.app]
}

# BL-127 (stand-alone identity): hyperspacevault.com, registered at Namecheap
# 2026-07-20. Unlike the swu subdomain above (whose zone lives in
# jeremy-portfolio), this domain's DNS lives HERE in swu-prod — decoupling the
# app from the portfolio infra is the point of the migration. Serving model:
# www is canonical, apex 301-redirects to www; swu.jeremybradenapps.com becomes
# a permanent redirect in a later step, only after www serves. Two-step flow,
# same as the June subdomain setup: apply creates the zone + custom-domain
# intents (wait_dns_verification = false), the hyperspacevault_* outputs then
# say which TXT/A records to add to the zone, and a follow-up PR adds them.
# Nameserver delegation at Namecheap (Jeremy-manual) uses the
# hyperspacevault_name_servers output.
resource "google_project_service" "dns" {
  project = var.project_id
  service = "dns.googleapis.com"

  disable_on_destroy = false
}

resource "google_dns_managed_zone" "hyperspacevault" {
  project     = var.project_id
  name        = "hyperspacevault-com"
  dns_name    = "hyperspacevault.com."
  description = "BL-127 stand-alone app domain; registrar Namecheap, nameservers delegated here"

  depends_on = [google_project_service.dns]
}

resource "google_firebase_hosting_custom_domain" "hyperspacevault_www" {
  provider = google-beta
  project  = var.project_id

  site_id       = var.project_id
  custom_domain = "www.hyperspacevault.com"

  wait_dns_verification = false

  depends_on = [module.app]
}

resource "google_firebase_hosting_custom_domain" "hyperspacevault_apex" {
  provider = google-beta
  project  = var.project_id

  site_id       = var.project_id
  custom_domain = "hyperspacevault.com"

  redirect_target       = "www.hyperspacevault.com"
  wait_dns_verification = false

  depends_on = [module.app]
}

# Step 2 of the two-step flow: the records the hyperspacevault_required_dns_
# updates output asked for (checked 2026-07-20, post-first-promote). Apex
# verifies ownership by TXT + serves by A; www delegates both by CNAME to the
# Hosting site. Namecheap delegation went live 2026-07-20 ~22:3xZ, so these
# become world-visible as soon as they apply. BL-94's sender-domain records
# (SPF/DKIM TXT+CNAMEs) will extend these record sets once the Identity
# Platform custom-domain flow is initiated in the console (its pending-domain
# field is not settable via the public API — attempted, documented in the
# 2026-07-20 field log).
resource "google_dns_record_set" "hyperspacevault_apex_a" {
  project      = var.project_id
  managed_zone = google_dns_managed_zone.hyperspacevault.name
  name         = google_dns_managed_zone.hyperspacevault.dns_name
  type         = "A"
  ttl          = 300
  rrdatas      = ["199.36.158.100"]
}

resource "google_dns_record_set" "hyperspacevault_apex_txt" {
  project      = var.project_id
  managed_zone = google_dns_managed_zone.hyperspacevault.name
  name         = google_dns_managed_zone.hyperspacevault.dns_name
  type         = "TXT"
  ttl          = 300
  # One record set holds ALL apex TXT values (DNS record sets are per
  # name+type): Hosting ownership (BL-127) + the BL-94 sender-domain pair
  # (SPF + project ownership), values read from the Identity Platform
  # custom-domain console flow 2026-07-20 (console-only initiation).
  rrdatas = [
    "\"hosting-site=swu-prod\"",
    "\"v=spf1 include:_spf.firebasemail.com ~all\"",
    "\"firebase=swu-prod\"",
  ]
}

# BL-94 layer 1: DKIM keys for noreply@hyperspacevault.com auth email.
# Verification completes in the Identity Platform console/backend once these
# resolve; sending flips from the default firebaseapp.com sender (spam-prone)
# to the custom domain when customDomainState reaches VERIFIED.
resource "google_dns_record_set" "hyperspacevault_dkim1" {
  project      = var.project_id
  managed_zone = google_dns_managed_zone.hyperspacevault.name
  name         = "firebase1._domainkey.${google_dns_managed_zone.hyperspacevault.dns_name}"
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["mail-hyperspacevault-com.dkim1._domainkey.firebasemail.com."]
}

resource "google_dns_record_set" "hyperspacevault_dkim2" {
  project      = var.project_id
  managed_zone = google_dns_managed_zone.hyperspacevault.name
  name         = "firebase2._domainkey.${google_dns_managed_zone.hyperspacevault.dns_name}"
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["mail-hyperspacevault-com.dkim2._domainkey.firebasemail.com."]
}

# BL-94 optional hardening (approved 2026-07-20): DMARC in monitoring-only
# mode (p=none) — declares a mail policy for the domain, which nudges
# receiver trust, without rejecting anything. No rua= reporting address for
# now (aggregate-report XML noise not worth it at this volume); tightening
# to quarantine/reject is a later call once real sending history exists.
resource "google_dns_record_set" "hyperspacevault_dmarc" {
  project      = var.project_id
  managed_zone = google_dns_managed_zone.hyperspacevault.name
  name         = "_dmarc.${google_dns_managed_zone.hyperspacevault.dns_name}"
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"v=DMARC1; p=none;\""]
}

resource "google_dns_record_set" "hyperspacevault_www_cname" {
  project      = var.project_id
  managed_zone = google_dns_managed_zone.hyperspacevault.name
  name         = "www.${google_dns_managed_zone.hyperspacevault.dns_name}"
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["swu-prod.web.app."]
}
