"""Catalog schema redesign: base_cards/card_variants split (BL-33 step 1)

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-21

Clean drop/recreate of the catalog tables per SWU_Catalog_Redesign_Spec.md
§4 — no data-preservation constraint, per Jeremy's 2026-06-20 confirmation
(comfortable losing all current inventory/catalog data as long as inventory
is reloadable from the F5 snapshot later — BL-33 step 4, not this
migration).

Replaces the flat `cards` table (one row per variant, boolean variant
flags) with `base_cards` (one row per root printing) + `card_variants`
(one row per printing, finish/provenance modeled as independent columns
instead of booleans). `card_aspects`/`card_traits`/`card_keywords` move
from per-variant to per-base-card. `card_details` folds into `base_cards`
(cost/power/hp/arena/is_unique); its unpopulated `sub_text` (BL-10) has no
replacement and is dropped, not ported. `inventory.card_id` is retargeted
to `inventory.variant_id` -> card_variants.id; the RLS policy from 0018
only references tenant_id and needs no change.

`sets.has_unique_variant_numbers` is dropped — the old-set card-number-
collision handling it supported is superseded by variant_of_uuid-based
resolution (mapping spec §5D). `sets.code` widens from 3 to 4 characters
to fit the long-tail container/standalone set codes BL-28's census found
(TS26, MV26, SORP, SHDP, TWIP, JTLP, LOFP, SECP, LAWP).

Inventory is truncated before the FK retarget — it's empty in practice
already after this migration's intent (existing rows reference cards.id
values that won't exist post-redesign), but TRUNCATE makes that explicit
rather than relying on a cascading drop to do it implicitly.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Empty out and detach inventory before dropping its FK target ---
    op.execute("TRUNCATE TABLE inventory")
    op.drop_constraint("inventory_card_id_fkey", "inventory", type_="foreignkey")

    # --- Drop the old per-variant enrichment tables and the flat cards table ---
    op.drop_table("card_details")
    op.drop_table("card_aspects")
    op.drop_table("card_keywords")
    op.drop_table("card_traits")
    op.drop_table("cards")

    # --- sets: drop the collision-handling flag, widen code, add swuapi fields ---
    op.drop_column("sets", "has_unique_variant_numbers")
    op.alter_column("sets", "code", type_=sa.String(4))
    op.add_column(
        "sets",
        sa.Column(
            "is_base_set",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("sets", sa.Column("release_date", sa.Date(), nullable=True))
    op.add_column("sets", sa.Column("total_cards", sa.Integer(), nullable=True))
    op.add_column(
        "sets", sa.Column("swuapi_updated_at", sa.DateTime(), nullable=True)
    )
    # The 7 sets seeded so far are all base sets; long-tail container/
    # standalone sets BL-29 ingests later default to false and are curated
    # explicitly (mapping spec §4 — the flag is curated, not derived).
    op.execute(
        "UPDATE sets SET is_base_set = true "
        "WHERE code IN ('SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'LAW')"
    )

    # --- base_cards (roots) ---
    op.create_table(
        "base_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("base_card_number", sa.String(10), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("subtitle", sa.String(200), nullable=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("type2", sa.String(20), nullable=True),
        sa.Column(
            "double_sided",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("rarity", sa.String(20), nullable=False),
        sa.Column("cost", sa.Integer(), nullable=True),
        sa.Column("power", sa.Integer(), nullable=True),
        sa.Column("hp", sa.Integer(), nullable=True),
        sa.Column("arena", sa.String(10), nullable=True),
        sa.Column("is_unique", sa.Boolean(), nullable=True),
        sa.Column("front_text", sa.Text(), nullable=True),
        sa.Column("back_text", sa.Text(), nullable=True),
        sa.Column("epic_action", sa.Text(), nullable=True),
        sa.Column("artist", sa.String(200), nullable=True),
        sa.Column("swuapi_id", sa.String(36), nullable=False),
        # standard_variant_id FK added after card_variants exists (circular ref).
        sa.Column("standard_variant_id", sa.Integer(), nullable=True),
        sa.Column(
            "is_token", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["set_id"], ["sets.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("swuapi_id", name="uq_base_cards_swuapi_id"),
    )
    op.create_index("ix_base_cards_set_id", "base_cards", ["set_id"])

    # --- card_variants (printings) ---
    op.create_table(
        "card_variants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("base_card_id", sa.Integer(), nullable=False),
        sa.Column("variant_type", sa.String(50), nullable=False),
        sa.Column("source_set_code", sa.String(4), nullable=False),
        sa.Column("card_number", sa.String(10), nullable=False),
        sa.Column("front_image_url", sa.String(500), nullable=True),
        sa.Column("back_image_url", sa.String(500), nullable=True),
        sa.Column("swuapi_id", sa.String(36), nullable=False),
        sa.Column("stamp_group", sa.String(50), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["base_card_id"], ["base_cards.id"]),
        sa.ForeignKeyConstraint(["source_set_code"], ["sets.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("swuapi_id", name="uq_card_variants_swuapi_id"),
    )
    op.create_index("ix_card_variants_base_card_id", "card_variants", ["base_card_id"])
    op.create_index(
        "ix_card_variants_source_set_code", "card_variants", ["source_set_code"]
    )

    op.create_foreign_key(
        "fk_base_cards_standard_variant_id",
        "base_cards",
        "card_variants",
        ["standard_variant_id"],
        ["id"],
    )

    # --- card_aspects / card_traits / card_keywords, re-keyed on base_card_id ---
    op.create_table(
        "card_aspects",
        sa.Column(
            "base_card_id", sa.Integer(), sa.ForeignKey("base_cards.id"), nullable=False
        ),
        sa.Column("aspect", sa.String(20), nullable=False),
        sa.PrimaryKeyConstraint("base_card_id", "aspect"),
    )
    op.create_table(
        "card_keywords",
        sa.Column(
            "base_card_id", sa.Integer(), sa.ForeignKey("base_cards.id"), nullable=False
        ),
        sa.Column("keyword", sa.String(50), nullable=False),
        sa.PrimaryKeyConstraint("base_card_id", "keyword"),
    )
    op.create_table(
        "card_traits",
        sa.Column(
            "base_card_id", sa.Integer(), sa.ForeignKey("base_cards.id"), nullable=False
        ),
        sa.Column("trait", sa.String(50), nullable=False),
        sa.PrimaryKeyConstraint("base_card_id", "trait"),
    )

    # --- inventory: retarget to card_variants ---
    op.alter_column("inventory", "card_id", new_column_name="variant_id")
    op.create_foreign_key(
        "fk_inventory_variant_id", "inventory", "card_variants", ["variant_id"], ["id"]
    )
    op.drop_constraint("uq_inventory_tenant_id_card_id", "inventory", type_="unique")
    op.create_unique_constraint(
        "uq_inventory_tenant_id_variant_id", "inventory", ["tenant_id", "variant_id"]
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_inventory_tenant_id_variant_id", "inventory", type_="unique"
    )
    op.drop_constraint("fk_inventory_variant_id", "inventory", type_="foreignkey")
    op.alter_column("inventory", "variant_id", new_column_name="card_id")
    op.create_unique_constraint(
        "uq_inventory_tenant_id_card_id", "inventory", ["tenant_id", "card_id"]
    )

    op.drop_table("card_traits")
    op.drop_table("card_keywords")
    op.drop_table("card_aspects")

    op.drop_constraint(
        "fk_base_cards_standard_variant_id", "base_cards", type_="foreignkey"
    )
    op.drop_table("card_variants")
    op.drop_table("base_cards")

    op.drop_column("sets", "swuapi_updated_at")
    op.drop_column("sets", "total_cards")
    op.drop_column("sets", "release_date")
    op.drop_column("sets", "is_base_set")
    op.alter_column("sets", "code", type_=sa.String(3))
    op.add_column(
        "sets", sa.Column("has_unique_variant_numbers", sa.Boolean(), nullable=True)
    )
    op.execute("UPDATE sets SET has_unique_variant_numbers = true")
    op.alter_column("sets", "has_unique_variant_numbers", nullable=False)

    op.create_table(
        "cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("base_card_number", sa.String(10), nullable=False),
        sa.Column("card_number", sa.String(10), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("rarity", sa.String(1), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column(
            "is_foil", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "is_hyperspace",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "is_prestige", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "is_showcase", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "is_organized_play",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["set_id"], ["sets.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "set_id",
            "card_number",
            "is_foil",
            "is_organized_play",
            "name",
            name="uq_cards_set_card_number_foil_op_name",
        ),
    )
    op.create_index("ix_cards_set_id", "cards", ["set_id"])
    op.create_index("ix_cards_base_card_number", "cards", ["base_card_number"])

    op.create_table(
        "card_details",
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("sub_text", sa.Text(), nullable=True),
        sa.Column("cost", sa.Integer(), nullable=True),
        sa.Column("power", sa.Integer(), nullable=True),
        sa.Column("hp", sa.Integer(), nullable=True),
        sa.Column("arena", sa.String(10), nullable=True),
        sa.Column("is_unique", sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint("card_id"),
    )
    op.create_table(
        "card_aspects",
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("aspect", sa.String(20), nullable=False),
        sa.PrimaryKeyConstraint("card_id", "aspect"),
    )
    op.create_table(
        "card_keywords",
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("keyword", sa.String(50), nullable=False),
        sa.PrimaryKeyConstraint("card_id", "keyword"),
    )
    op.create_table(
        "card_traits",
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("cards.id"), nullable=False),
        sa.Column("trait", sa.String(50), nullable=False),
        sa.PrimaryKeyConstraint("card_id", "trait"),
    )

    op.create_foreign_key(
        "inventory_card_id_fkey", "inventory", "cards", ["card_id"], ["id"]
    )
