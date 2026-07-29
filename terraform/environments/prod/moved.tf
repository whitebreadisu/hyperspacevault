# BL-43 Phase 2: state-address migrations for resources relocated into
# terraform/modules/app/. One moved{} block per managed resource; without
# these Terraform would plan to destroy and recreate every prod resource.
# Data sources are excluded (they have no persistent state to migrate).

# --- artifact_registry.tf ---

moved {
  from = google_artifact_registry_repository.backend
  to   = module.app.google_artifact_registry_repository.backend
}

# --- database.tf ---

moved {
  from = google_sql_database_instance.main
  to   = module.app.google_sql_database_instance.main
}

moved {
  from = google_sql_database.inventory
  to   = module.app.google_sql_database.inventory
}

moved {
  from = google_sql_user.app
  to   = module.app.google_sql_user.app
}

# --- secrets.tf ---

moved {
  from = random_password.db_password
  to   = module.app.random_password.db_password
}

moved {
  from = google_secret_manager_secret.db_password
  to   = module.app.google_secret_manager_secret.db_password
}

moved {
  from = google_secret_manager_secret_version.db_password
  to   = module.app.google_secret_manager_secret_version.db_password
}

moved {
  from = google_secret_manager_secret.database_url
  to   = module.app.google_secret_manager_secret.database_url
}

moved {
  from = google_secret_manager_secret_version.database_url
  to   = module.app.google_secret_manager_secret_version.database_url
}

moved {
  from = google_secret_manager_secret_iam_member.backend_runtime_database_url
  to   = module.app.google_secret_manager_secret_iam_member.backend_runtime_database_url
}

moved {
  from = random_password.app_db_password
  to   = module.app.random_password.app_db_password
}

moved {
  from = google_secret_manager_secret.app_db_password
  to   = module.app.google_secret_manager_secret.app_db_password
}

moved {
  from = google_secret_manager_secret_version.app_db_password
  to   = module.app.google_secret_manager_secret_version.app_db_password
}

moved {
  from = google_secret_manager_secret_iam_member.backend_runtime_app_db_password
  to   = module.app.google_secret_manager_secret_iam_member.backend_runtime_app_db_password
}

moved {
  from = google_secret_manager_secret.app_database_url
  to   = module.app.google_secret_manager_secret.app_database_url
}

moved {
  from = google_secret_manager_secret_version.app_database_url
  to   = module.app.google_secret_manager_secret_version.app_database_url
}

moved {
  from = google_secret_manager_secret_iam_member.backend_runtime_app_database_url
  to   = module.app.google_secret_manager_secret_iam_member.backend_runtime_app_database_url
}

# --- identity_platform.tf ---

moved {
  from = google_identity_platform_config.default
  to   = module.app.google_identity_platform_config.default
}

# --- firebase.tf ---

moved {
  from = google_firebase_project.default
  to   = module.app.google_firebase_project.default
}

moved {
  from = google_firebase_web_app.default
  to   = module.app.google_firebase_web_app.default
}

# --- cloud_run.tf ---

moved {
  from = google_service_account.backend_runtime
  to   = module.app.google_service_account.backend_runtime
}

moved {
  from = google_project_iam_member.backend_runtime_cloudsql_client
  to   = module.app.google_project_iam_member.backend_runtime_cloudsql_client
}

moved {
  from = google_cloud_run_v2_service.backend
  to   = module.app.google_cloud_run_v2_service.backend
}

moved {
  from = google_cloud_run_v2_service_iam_member.backend_public
  to   = module.app.google_cloud_run_v2_service_iam_member.backend_public
}

# --- monitoring.tf ---

moved {
  from = google_monitoring_dashboard.backend
  to   = module.app.google_monitoring_dashboard.backend
}

moved {
  from = google_monitoring_notification_channel.email
  to   = module.app.google_monitoring_notification_channel.email
}

moved {
  from = google_monitoring_alert_policy.high_5xx_rate
  to   = module.app.google_monitoring_alert_policy.high_5xx_rate
}

# --- main.tf (p2/p2_stage4/p5/p6 google_project_service resources) ---
# for_each resources: the map key is part of the state address.

moved {
  from = google_project_service.p2["artifactregistry.googleapis.com"]
  to   = module.app.google_project_service.p2["artifactregistry.googleapis.com"]
}

moved {
  from = google_project_service.p2["sqladmin.googleapis.com"]
  to   = module.app.google_project_service.p2["sqladmin.googleapis.com"]
}

moved {
  from = google_project_service.p2["secretmanager.googleapis.com"]
  to   = module.app.google_project_service.p2["secretmanager.googleapis.com"]
}

moved {
  from = google_project_service.p2["run.googleapis.com"]
  to   = module.app.google_project_service.p2["run.googleapis.com"]
}

moved {
  from = google_project_service.p2_stage4["firebase.googleapis.com"]
  to   = module.app.google_project_service.p2_stage4["firebase.googleapis.com"]
}

moved {
  from = google_project_service.p2_stage4["firebasehosting.googleapis.com"]
  to   = module.app.google_project_service.p2_stage4["firebasehosting.googleapis.com"]
}

moved {
  from = google_project_service.p5["identitytoolkit.googleapis.com"]
  to   = module.app.google_project_service.p5["identitytoolkit.googleapis.com"]
}

moved {
  from = google_project_service.p6["monitoring.googleapis.com"]
  to   = module.app.google_project_service.p6["monitoring.googleapis.com"]
}

moved {
  from = google_project_service.p6["clouderrorreporting.googleapis.com"]
  to   = module.app.google_project_service.p6["clouderrorreporting.googleapis.com"]
}
