# P6 stage 2: a saved Cloud Monitoring dashboard for the backend Cloud Run
# service, built entirely from metrics Cloud Run already emits -- no
# application code changes. Three tiles: request rate (by response-code
# class), error rate (5xx as a % of total, via an MQL ratio query -- see the
# "Built-in Metrics vs. MQL" concept in the Learning Guide), and latency
# (p50/p95).
#
# JSON alignment notes (GCP API behaviour):
#   - Zero-valued tile positions (xPos=0, yPos=0) are omitted by the API;
#     omit them here to prevent perpetual plan diffs.
#   - Each dataset gets a default targetAxis="Y1" from the API; declare it
#     explicitly so the plan sees no diff.
#   - groupByFields=[] is omitted by the API; omit it here too.
resource "google_monitoring_dashboard" "backend" {
  # The GCP API injects `etag` and `name` into the returned JSON; Terraform
  # sees them in state but not in our jsonencode(), which produces a perpetual
  # plan diff (BL-43 Phase 6). Suppress it here — deliberate updates are done
  # by temporarily removing this block and re-adding it after apply.
  lifecycle {
    ignore_changes = [dashboard_json]
  }

  dashboard_json = jsonencode({
    displayName = "Backend Overview"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          # xPos = 0, yPos = 0 omitted — GCP does not return zero-valued positions.
          width  = 6
          height = 4
          widget = {
            title = "Request Rate by Response Code"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.backend.name}\" AND metric.type=\"run.googleapis.com/request_count\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.response_code_class"]
                    }
                  }
                }
                plotType       = "STACKED_AREA"
                legendTemplate = "$${metric.labels.response_code_class}"
                targetAxis     = "Y1"
              }]
              yAxis = {
                label = "requests/sec"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          xPos = 6
          # yPos = 0 omitted — GCP does not return zero-valued positions.
          width  = 6
          height = 4
          widget = {
            title = "Error Rate (5xx % of requests)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesQueryLanguage = <<-MQL
                    { fetch cloud_run_revision
                      | metric 'run.googleapis.com/request_count'
                      | filter resource.service_name == '${google_cloud_run_v2_service.backend.name}' && metric.response_code_class == '5xx'
                      | align rate(1m)
                      | group_by [], [val: sum(value.request_count)]
                    ; fetch cloud_run_revision
                      | metric 'run.googleapis.com/request_count'
                      | filter resource.service_name == '${google_cloud_run_v2_service.backend.name}'
                      | align rate(1m)
                      | group_by [], [val: sum(value.request_count)]
                    }
                    | ratio
                    | value [error_rate_pct: val() * 100]
                  MQL
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              yAxis = {
                label = "%"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          # xPos = 0 omitted — GCP does not return zero-valued positions.
          yPos   = 4
          width  = 12
          height = 4
          widget = {
            title = "Request Latency (p50 / p95)"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.backend.name}\" AND metric.type=\"run.googleapis.com/request_latencies\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_PERCENTILE_50"
                        crossSeriesReducer = "REDUCE_MEAN"
                        # groupByFields = [] omitted — GCP does not return empty arrays.
                      }
                    }
                  }
                  plotType       = "LINE"
                  legendTemplate = "p50"
                  targetAxis     = "Y1"
                },
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.backend.name}\" AND metric.type=\"run.googleapis.com/request_latencies\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_PERCENTILE_95"
                        crossSeriesReducer = "REDUCE_MEAN"
                        # groupByFields = [] omitted — GCP does not return empty arrays.
                      }
                    }
                  }
                  plotType       = "LINE"
                  legendTemplate = "p95"
                  targetAxis     = "Y1"
                }
              ]
              yAxis = {
                label = "ms"
                scale = "LINEAR"
              }
            }
          }
        }
      ]
    }
  })

  depends_on = [google_project_service.p6]
}

# P6 stage 3: an email notification channel plus an alert policy that fires
# when the backend returns any 5xx response. Reuses the exact filter and
# aggregation from the "Request Rate by Response Code" tile above, narrowed
# to the 5xx response-code class -- see "Alert Policies & Notification
# Channels" and "Alert Fatigue, Concretely" in the Learning Guide for why
# "any 5xx, sustained for 60s" is the right threshold at this traffic volume.
resource "google_monitoring_notification_channel" "email" {
  display_name = var.notification_channel_display_name
  type         = "email"

  labels = {
    email_address = var.notification_email
  }
}

# RR-9: uptime check + alert. The 5xx alert below fires when the app answers
# with errors; nothing fired when it didn't answer at all (crash, botched DNS,
# expired cert, misconfig). This probes from the public internet — the only
# vantage point that sees what users see.
#
# Target choice: the backend's Cloud Run /health URL directly, NOT the Hosting
# /api/* path the repo-review backlog floated as the alternative — RR-3 put
# s-maxage=3600 on catalog responses, so the Hosting path can serve CDN HITs
# for up to an hour after the backend dies, masking exactly the outage this
# check exists to catch. /health is uncached and hits the service every time.
# Applied via the module = both envs get it (dev doubles as the canary that
# validates the resource shape before prod applies); noise cost is one email
# if dev is ever down, accepted.
resource "google_monitoring_uptime_check_config" "backend_health" {
  display_name = "Backend /health uptime check"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.backend.uri, "https://")
    }
  }

  depends_on = [google_project_service.p6]
}

resource "google_monitoring_alert_policy" "uptime_failure" {
  display_name = "Backend Uptime Check Failure"
  combiner     = "OR"

  conditions {
    display_name = "Backend /health unreachable from the public internet"

    # Canonical uptime-alert shape (matches what the GCP console generates):
    # count the check_passed=false points in a 20-min window per checker
    # region; alert when any series shows a failure sustained 300s.
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.backend_health.uptime_check_id}\""
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

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "The backend's /health endpoint is failing the external uptime check — the service is unreachable from the public internet (not just erroring). Check the Cloud Run service status and recent deploys first, then Cloud Logging. Response steps: see the Operations Runbook in SWU_Platform_Spec.md (RR-8)."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.p6]
}

# RR-9 (optional half): p95 latency alert. Generous by construction — 2s
# sustained for 15 minutes is far above normal (dashboard p95 runs well under
# 1s warm) but catches real degradation (DB contention, connection-pool
# exhaustion, runaway cold-start loop) before users report it.
resource "google_monitoring_alert_policy" "high_p95_latency" {
  display_name = "Elevated p95 Request Latency"
  combiner     = "OR"

  conditions {
    display_name = "Backend p95 latency above 2s for 15 minutes"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.backend.name}\" AND metric.type=\"run.googleapis.com/request_latencies\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2000
      duration        = "900s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = []
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "Backend p95 request latency has stayed above 2 seconds for 15 minutes. Check the \"Backend Overview\" dashboard latency tile, then Cloud SQL CPU/connections and Cloud Run instance count."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.p6]
}

resource "google_monitoring_alert_policy" "high_5xx_rate" {
  display_name = "Elevated 5xx Error Rate"
  combiner     = "OR"

  conditions {
    display_name = "Backend returning 5xx responses"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.backend.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = []
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "The backend returned at least one 5xx response in the last minute. Check the \"Backend Overview\" dashboard and Cloud Logging (severity=ERROR) for the request's traceback."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.p6]
}

# BL-156 (A5-07): "alerting round 2" -- four surfaces added since the P6
# observability stack that were still unalerted, ranked by blast radius in
# the audit. Import errors were also audited (A5-07 #5) and found already
# covered by high_5xx_rate above -- no new resource needed for that one.

# #1: price-sync job failure or silence. Cloud Run *Jobs* emit no request
# metrics, so a failed `price-sync` execution (or a scheduler misfire that
# never runs it at all) triggers nothing today -- the only detection has been
# the owner noticing stale `as_of` dates. Two conditions, either one opens the
# incident (combiner OR at the policy level covers both conditions too):
#   - a completed task attempt with result=failed, any time in the window
#   - silence: no result=succeeded attempt for a full day plus 2h of slack
#     (scheduler fires 20:30 UTC daily per pricing_jobs.tf; the slack means
#     a slightly late tcgcsv build doesn't page). NOT condition_absent: the
#     API caps absence durations at 23h30m (#443's apply rejection), and any
#     absence window shorter than the job's 24h period would false-page
#     daily in the ~30min before each run. Instead: a threshold condition
#     on the trailing-24h success count with COMPARISON_LT 1 and
#     evaluation_missing_data=ACTIVE (an empty window has no points at all,
#     so missing data must itself trip the condition), sustained 2h --
#     equivalent to the original 26h-absence intent, validated by a real
#     policy create against the dev Monitoring API (2026-07-25).
# Metric verified live via the Monitoring API (2026-07-25): both
# run.googleapis.com/job/completed_task_attempt_count (labels: result,
# attempt) and the cloud_run_job resource's job_name/location/project_id
# labels exist exactly as used below.
resource "google_monitoring_alert_policy" "price_sync_job_failure" {
  display_name = "Price-Sync Job Failed or Silent"
  combiner     = "OR"

  conditions {
    display_name = "price-sync job task attempt completed with result=failed"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.price_sync.name}\" AND metric.type=\"run.googleapis.com/job/completed_task_attempt_count\" AND metric.label.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = []
      }

      trigger {
        count = 1
      }
    }
  }

  conditions {
    display_name = "no successful price-sync execution in the trailing 24h + 2h grace (scheduler fires 20:30 UTC daily)"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.price_sync.name}\" AND metric.type=\"run.googleapis.com/job/completed_task_attempt_count\" AND metric.label.result=\"succeeded\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "7200s"

      aggregations {
        alignment_period     = "86400s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }

      evaluation_missing_data = "EVALUATION_MISSING_DATA_ACTIVE"
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "The daily price-sync Cloud Run Job either failed a task attempt or hasn't reported a successful run in 26 hours. Prices are going stale app-wide. Check `gcloud run jobs executions list --job=price-sync` and the job's logs; a bare `gcloud run jobs execute price-sync` is always safe to re-run (watermark-gated, idempotent -- see pricing_jobs.tf)."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.p6, google_cloud_run_v2_job.price_sync]
}

# #2: Cloud SQL backup failure. Researched before building: the Monitoring
# API's metricDescriptors.list for "cloudsql.googleapis.com/database/backup*"
# returns an EMPTY result for this project (checked live 2026-07-25) -- there
# is no dedicated Cloud Monitoring metric for backup success/failure. Backups
# ARE captured in the Cloud Audit "system_event" log as a
# `cloudsql.instances.automatedBackup` entry with a
# `protoPayload.metadata.windowStatus` field; a real entry pulled live
# (2026-07-24 21:26Z, prod) showed `windowStatus = "STATUS_SUCCEEDED"`. A
# log-based metric on that field is therefore the only available signal, per
# the brief's "research what the provider/metrics actually support" ask.
resource "google_logging_metric" "sql_backup_failure" {
  name = "cloudsql-backup-failure"

  filter = <<-EOT
    resource.type="cloudsql_database"
    resource.labels.database_id="${var.project_id}:${google_sql_database_instance.main.name}"
    protoPayload.methodName="cloudsql.instances.automatedBackup"
    protoPayload.metadata.windowStatus!="STATUS_SUCCEEDED"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "sql_backup_failure" {
  display_name = "Cloud SQL Backup Failure"
  combiner     = "OR"

  conditions {
    display_name = "Automated backup window did not report STATUS_SUCCEEDED"

    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.sql_backup_failure.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "A Cloud SQL automated backup window did not complete with STATUS_SUCCEEDED. This is a silent, maximal-blast-radius failure mode -- data-loss exposure with no other alarm. Check the instance's Backups tab in the console and Cloud Logging (cloudaudit.googleapis.com/system_event, methodName=cloudsql.instances.automatedBackup) for the failure detail. BL-21's restore drill is the companion check that verifies restores actually work, not just that backups run."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.p6, google_logging_metric.sql_backup_failure]
}

# #3: Cloud SQL saturation -- three separate alerts (connections, memory,
# CPU), the BL-146 pre-fix incident signature (list endpoint -> 503 under
# backfill writes was exactly a saturation event none of these would have
# caught at the time).
resource "google_monitoring_alert_policy" "sql_connections_saturation" {
  display_name = "Cloud SQL Connections Saturation"
  combiner     = "OR"

  conditions {
    display_name = "PostgreSQL connections above 80% of max_connections"

    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.main.name}\" AND metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.sql_max_connections * 0.8
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = []
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "PostgreSQL connections (num_backends) have stayed above 80% of max_connections for 5 minutes. This is A5-06's latent outage mode -- SQLAlchemy pool caps (BL-150 D2) keep per-instance connection demand bounded, but this alert is the early warning before `FATAL: remaining connection slots are reserved` actually happens. Check Cloud Run instance_count (scale-out event?) and the pricing jobs (concurrent execution?)."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.p6]
}

# Memory: deliberately NOT built on memory/utilization, which A5-05 found
# pinned at a constant 1.0000 on both envs -- its description says it
# INCLUDES the OS page cache, so on a small instance it is structurally
# always ~100% and a threshold on it would open one incident and never
# close. The first re-land attempt (#443) tried an MQL usage/quota ratio
# instead; the apply rejected its `align mean(1m)` clause ("Expected type
# 'Summable' but got 'Duration'" -- MQL parses `mean` there as the value
# aggregator, not a temporal aligner), and live-running the corrected
# ratio (2026-07-25) showed usage/quota ALSO pins at ~1.0 on f1-micro --
# the usage byte-gauge evidently includes cache too, so the ratio was the
# same information-free alarm with extra steps. The actual signal is
# memory/components, which breaks memory into Usage / Cache / Free as
# percentages: live values (2026-07-25) dev Usage=21.6% Cache=15.1%
# Free=63.3%, prod Usage=6.1% -- real headroom both envs. Alert on the
# Usage component (cache genuinely excluded), already a percentage so it
# adapts to whichever tier an environment runs (f1-micro dev / g1-small
# prod after BL-150 D4). Validated by a real policy create against the
# dev Monitoring API (2026-07-25).
resource "google_monitoring_alert_policy" "sql_memory_saturation" {
  display_name = "Cloud SQL Memory Saturation"
  combiner     = "OR"

  conditions {
    display_name = "Memory Usage component (excluding page cache) above 95%, sustained 30 minutes"

    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.main.name}\" AND metric.type=\"cloudsql.googleapis.com/database/memory/components\" AND metric.label.component=\"Usage\""
      comparison      = "COMPARISON_GT"
      threshold_value = 95
      duration        = "1800s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = []
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "Cloud SQL's memory Usage component (memory/components, component=Usage -- the breakdown that genuinely excludes OS page cache, unlike the always-~100% memory/utilization and memory/usage gauges; see the comment above this resource) has stayed above 95% for 30 minutes. This reflects real memory pressure. Check for a runaway query, a pricing-job spike, or genuine growth past the tier's headroom (A5-05)."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.p6]
}

resource "google_monitoring_alert_policy" "sql_cpu_saturation" {
  display_name = "Cloud SQL CPU Saturation"
  combiner     = "OR"

  conditions {
    display_name = "CPU utilization above 80%, sustained 15 minutes"

    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.main.name}\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "900s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = []
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "Cloud SQL CPU utilization has stayed above 80% for 15 minutes -- well above the observed baseline (mean ~9-10%, A5-05). Shared-core tiers (f1-micro, g1-small) can burst-throttle under sustained load; check for a runaway query or a pricing-job/backfill running concurrently with normal traffic."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.p6]
}
