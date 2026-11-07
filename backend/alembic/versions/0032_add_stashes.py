"""Add stashes and stash_items (BL-344: named places for owned copies)

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-07

A stash is a named place outside the Vault; each owned copy of a printing is
in the Vault or in exactly one stash. `stash_items` holds only the stashed
part -- Vault = owned - stashed is derived, never stored.

Invariant, enforced here in Postgres as the backstop to the service layer's
friendly 409: for every (tenant, variant), SUM(stash_items.quantity) <=
inventory.quantity (a missing inventory row counts as 0). Two deferrable
constraint triggers, both INITIALLY DEFERRED so a multi-statement
transaction (an import cut, a PUT split, an account purge) is judged at
commit, not mid-way:
  - stash_items INSERT/UPDATE re-checks the touched (tenant, variant);
  - inventory UPDATE (quantity lowered, or key changed) / DELETE re-checks
    the touched (tenant, variant).
(Each check first locks the (tenant, variant) inventory row FOR UPDATE, so
two transactions stashing the same printing into different stashes serialize
and the later one sees the earlier one's committed rows.)

RLS and grants follow the shares table: tenant_isolation FOR ALL (NULLIF so
an unset or empty GUC matches nothing) and SELECT/INSERT/UPDATE/DELETE to
swu_app. A share-token session carries the owner's tenant GUC, so RLS alone
would let it read these tables; what keeps stash data out of the shared view
is that no shared route reads it (and the test that asserts it).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: Union[str, None] = "0031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TENANT_PREDICATE = (
    "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::integer"
)


def upgrade() -> None:
    op.create_table(
        "stashes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False
        ),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("description", sa.String(280), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "tenant_id", name="uq_stashes_id_tenant_id"),
        sa.CheckConstraint(
            "char_length(name) BETWEEN 1 AND 40", name="ck_stashes_name_length"
        ),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_stashes_tenant_lower_name "
        "ON stashes (tenant_id, lower(name))"
    )

    op.create_table(
        "stash_items",
        sa.Column("stash_id", sa.Integer(), nullable=False),
        sa.Column(
            "tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False
        ),
        sa.Column(
            "variant_id",
            sa.Integer(),
            sa.ForeignKey("card_variants.id"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("stash_id", "variant_id"),
        # Composite: a stash item can only point at a stash of its own tenant.
        sa.ForeignKeyConstraint(
            ["stash_id", "tenant_id"],
            ["stashes.id", "stashes.tenant_id"],
            name="fk_stash_items_stash_id_tenant_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("quantity > 0", name="ck_stash_items_quantity_positive"),
    )
    op.create_index(
        "ix_stash_items_tenant_variant", "stash_items", ["tenant_id", "variant_id"]
    )

    for table in ("stashes", "stash_items"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table} FOR ALL
            USING ({_TENANT_PREDICATE})
            WITH CHECK ({_TENANT_PREDICATE})
            """
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO swu_app")
    op.execute("GRANT USAGE, SELECT ON SEQUENCE stashes_id_seq TO swu_app")

    # The invariant backstop. The function re-derives both sides for one
    # (tenant, variant) and raises when stashed > owned. It filters by
    # tenant_id explicitly; RLS agrees for swu_app.
    op.execute(
        """
        CREATE FUNCTION stash_check_invariant() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            t_id integer;
            v_id integer;
            stashed bigint;
            owned bigint;
        BEGIN
            IF TG_OP = 'DELETE' OR TG_TABLE_NAME = 'inventory' THEN
                t_id := OLD.tenant_id;
                v_id := OLD.variant_id;
            ELSE
                t_id := NEW.tenant_id;
                v_id := NEW.variant_id;
            END IF;

            -- Serialize on the (tenant, variant) inventory row before
            -- summing: without this two transactions inserting into
            -- different stashes could each see only their own rows and
            -- both commit over owned (write skew). A missing row = 0 owned
            -- (nothing to lock; the sum below then fails any stashed > 0).
            SELECT COALESCE(SUM(quantity), 0) INTO owned
            FROM (
                SELECT quantity FROM inventory
                WHERE tenant_id = t_id AND variant_id = v_id
                FOR UPDATE
            ) locked;

            SELECT COALESCE(SUM(quantity), 0) INTO stashed
            FROM stash_items WHERE tenant_id = t_id AND variant_id = v_id;

            IF stashed > owned THEN
                RAISE EXCEPTION 'stash_invariant: % stashed but % owned (tenant %, variant %)',
                    stashed, owned, t_id, v_id
                    USING ERRCODE = '23514';
            END IF;
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER stash_items_invariant
        AFTER INSERT OR UPDATE ON stash_items
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION stash_check_invariant()
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER inventory_stash_invariant_update
        AFTER UPDATE ON inventory
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        WHEN (NEW.quantity < OLD.quantity
              OR NEW.variant_id <> OLD.variant_id
              OR NEW.tenant_id <> OLD.tenant_id)
        EXECUTE FUNCTION stash_check_invariant()
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER inventory_stash_invariant_delete
        AFTER DELETE ON inventory
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION stash_check_invariant()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER inventory_stash_invariant_delete ON inventory")
    op.execute("DROP TRIGGER inventory_stash_invariant_update ON inventory")
    op.execute("DROP TRIGGER stash_items_invariant ON stash_items")
    op.execute("DROP FUNCTION stash_check_invariant()")
    op.execute("REVOKE USAGE, SELECT ON SEQUENCE stashes_id_seq FROM swu_app")
    for table in ("stash_items", "stashes"):
        op.execute(f"REVOKE SELECT, INSERT, UPDATE, DELETE ON {table} FROM swu_app")
        op.execute(f"DROP POLICY tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_table("stash_items")
    op.drop_table("stashes")
