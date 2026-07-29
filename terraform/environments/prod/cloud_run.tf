# Resources moved to terraform/modules/app/cloud_run.tf (BL-43 Phase 2).
# google_service_account.backend_runtime                     -> module.app.google_service_account.backend_runtime
# google_project_iam_member.backend_runtime_cloudsql_client  -> module.app.google_project_iam_member.backend_runtime_cloudsql_client
# google_cloud_run_v2_service.backend                        -> module.app.google_cloud_run_v2_service.backend
# google_cloud_run_v2_service_iam_member.backend_public      -> module.app.google_cloud_run_v2_service_iam_member.backend_public
# See moved.tf for the state-address migration blocks.
