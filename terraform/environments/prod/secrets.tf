# Resources moved to terraform/modules/app/secrets.tf (BL-43 Phase 2).
# random_password.db_password                                      -> module.app.random_password.db_password
# google_secret_manager_secret.db_password                         -> module.app.google_secret_manager_secret.db_password
# google_secret_manager_secret_version.db_password                 -> module.app.google_secret_manager_secret_version.db_password
# google_secret_manager_secret.database_url                        -> module.app.google_secret_manager_secret.database_url
# google_secret_manager_secret_version.database_url                -> module.app.google_secret_manager_secret_version.database_url
# google_secret_manager_secret_iam_member.backend_runtime_database_url -> module.app.google_secret_manager_secret_iam_member.backend_runtime_database_url
# random_password.app_db_password                                  -> module.app.random_password.app_db_password
# google_secret_manager_secret.app_db_password                     -> module.app.google_secret_manager_secret.app_db_password
# google_secret_manager_secret_version.app_db_password             -> module.app.google_secret_manager_secret_version.app_db_password
# google_secret_manager_secret_iam_member.backend_runtime_app_db_password -> module.app.google_secret_manager_secret_iam_member.backend_runtime_app_db_password
# google_secret_manager_secret.app_database_url                    -> module.app.google_secret_manager_secret.app_database_url
# google_secret_manager_secret_version.app_database_url            -> module.app.google_secret_manager_secret_version.app_database_url
# google_secret_manager_secret_iam_member.backend_runtime_app_database_url -> module.app.google_secret_manager_secret_iam_member.backend_runtime_app_database_url
# See moved.tf for the state-address migration blocks.
