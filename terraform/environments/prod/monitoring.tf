# Resources moved to terraform/modules/app/monitoring.tf (BL-43 Phase 2).
# google_monitoring_dashboard.backend                -> module.app.google_monitoring_dashboard.backend
# google_monitoring_notification_channel.email       -> module.app.google_monitoring_notification_channel.email
# google_monitoring_alert_policy.high_5xx_rate       -> module.app.google_monitoring_alert_policy.high_5xx_rate
# See moved.tf for the state-address migration blocks.

# BL-156 (A5-07 #4): custom-domain front door probe -- prod only, unlike the
# module's backend_health uptime check. The existing probe (monitoring.tf in
# the module) deliberately targets the direct *.run.app /health URL to avoid
# CDN masking (see its own comment), which is the right call for "is the
# backend up" -- but it means www.hyperspacevault.com / Firebase Hosting
# itself has no external probe: a DNS, TLS cert, or Hosting-layer failure
# takes down every real user while /health stays green throughout. This is a
# genuinely per-environment resource (dev has no custom domain to probe), so
# it lives here rather than in the module -- following the same pattern as
# the hyperspacevault_* resources in custom_domain.tf. Reuses the module's
# single notification channel via the notification_channel_id output (added
# for this purpose) rather than duplicating a channel.
resource "google_monitoring_uptime_check_config" "custom_domain" {
  display_name = "Custom domain (www.hyperspacevault.com) uptime check"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = "www.hyperspacevault.com"
    }
  }

  depends_on = [module.app, google_firebase_hosting_custom_domain.hyperspacevault_www]
}

resource "google_monitoring_alert_policy" "custom_domain_uptime_failure" {
  display_name = "Custom Domain Uptime Check Failure"
  combiner     = "OR"

  conditions {
    display_name = "www.hyperspacevault.com unreachable from the public internet"

    # Same canonical uptime-alert shape as the module's backend_health check
    # (monitoring.tf in the module): count check_passed=false points in a
    # 20-min window per checker region, alert on any sustained-300s failure.
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.custom_domain.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.project_id", "resource.label.host"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [module.app.notification_channel_id]

  documentation {
    content   = "www.hyperspacevault.com is failing the external uptime check -- the custom domain is unreachable from the public internet even though the direct Cloud Run *.run.app /health check may still be green (that check deliberately bypasses this domain). Check Firebase Hosting custom-domain status (ownership_state/host_state, custom_domain.tf outputs), DNS records in the hyperspacevault Cloud DNS zone, and TLS cert provisioning before assuming a backend problem."
    mime_type = "text/markdown"
  }

  depends_on = [module.app]
}
