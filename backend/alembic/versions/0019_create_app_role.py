"""Create swu_app role for RLS-aware connections (P4 Stage 2)

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-13

swu_user is the bootstrap superuser (POSTGRES_USER) and BYPASSRLS can
never be removed from it -- the inventory.tenant_isolation policy from
0018 is permanently inert against that role. swu_app is a plain LOGIN
role (NOSUPERUSER, NOBYPASSRLS) that the tenant_isolation policy
actually applies to: read access everywhere, and write access on
inventory only -- the one table the application mutates. Default
privileges cover tables/sequences swu_user creates in future
migrations, so swu_app doesn't silently lose access to new tables.
"""
import os
from typing import Sequence, Union

from alembic import op


revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    password = os.environ["APP_DB_PASSWORD"].replace("'", "''")

    op.execute(
        f"CREATE ROLE swu_app WITH LOGIN PASSWORD '{password}' "
        "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
    )
    op.execute("GRANT USAGE ON SCHEMA public TO swu_app")
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO swu_app")
    op.execute("GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO swu_app")
    op.execute("GRANT INSERT, UPDATE, DELETE ON inventory TO swu_app")
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE swu_user IN SCHEMA public "
        "GRANT SELECT ON TABLES TO swu_app"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE swu_user IN SCHEMA public "
        "GRANT SELECT, USAGE ON SEQUENCES TO swu_app"
    )


def downgrade() -> None:
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE swu_user IN SCHEMA public "
        "REVOKE SELECT, USAGE ON SEQUENCES FROM swu_app"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE swu_user IN SCHEMA public "
        "REVOKE SELECT ON TABLES FROM swu_app"
    )
    op.execute("DROP OWNED BY swu_app")
    op.execute("DROP ROLE swu_app")
