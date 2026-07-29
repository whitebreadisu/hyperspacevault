"""Normalize capitalization of variant card names to match their standard cards

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-10

Migration 0010 resolved base_card_numbers using case-insensitive name matching,
which correctly linked Hyperspace/Foil variants to their standard cards. However,
the stored names themselves were left inconsistent — the TCGPlayer CSV uses one
capitalization for the standard row and a different one for variant rows.

This migration normalizes the 9 affected variant groups by updating their stored
names to match the standard card's name. The source CSVs are corrected on disk
to keep future F3 re-runs idempotent.

Affected cards (variant card_numbers → standard name used):
  JTL 485, 721, 957, 1044, 1080  'Ride For Hire' → 'Ride for Hire'
  SHD 331                         'Follower of the Way' → 'Follower of The Way'
  SHD 375                         'Rule With Respect' → 'Rule with Respect'
  SHD 423                         'Wrecker - BOOM!' → 'Wrecker - Boom!'
  TWI 345                         'I Have the High Ground' → 'I Have The High Ground'
  TWI 362                         'Echo - Valiant ARC Trooper' → 'Echo - Valiant Arc Trooper'
  TWI 403                         'Darth Maul - Revenge At Last' → 'Darth Maul - Revenge at Last'
  TWI 455                         'On the Doorstep' → 'On The Doorstep'
  TWI 505                         'Eta-2 Light Interceptor' → 'ETA-2 Light Interceptor'
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UPDATES = [
    # (set_code, card_numbers, old_name, new_name)
    ("JTL", ("485", "721", "957", "1044", "1080"),
     "Razor Crest - Ride For Hire", "Razor Crest - Ride for Hire"),
    ("SHD", ("331",),
     "Follower of the Way", "Follower of The Way"),
    ("SHD", ("375",),
     "Rule With Respect", "Rule with Respect"),
    ("SHD", ("423",),
     "Wrecker - BOOM!", "Wrecker - Boom!"),
    ("TWI", ("345",),
     "I Have the High Ground", "I Have The High Ground"),
    ("TWI", ("362",),
     "Echo - Valiant ARC Trooper", "Echo - Valiant Arc Trooper"),
    ("TWI", ("403",),
     "Darth Maul - Revenge At Last", "Darth Maul - Revenge at Last"),
    ("TWI", ("455",),
     "On the Doorstep", "On The Doorstep"),
    ("TWI", ("505",),
     "Eta-2 Light Interceptor", "ETA-2 Light Interceptor"),
]


def upgrade() -> None:
    for set_code, card_numbers, old_name, new_name in _UPDATES:
        nums = ", ".join(f"'{n}'" for n in card_numbers)
        op.execute(f"""
            UPDATE cards
            SET name = '{new_name}'
            WHERE set_id = (SELECT id FROM sets WHERE code = '{set_code}')
              AND card_number IN ({nums})
              AND name = '{old_name}'
        """)


def downgrade() -> None:
    for set_code, card_numbers, old_name, new_name in _UPDATES:
        nums = ", ".join(f"'{n}'" for n in card_numbers)
        op.execute(f"""
            UPDATE cards
            SET name = '{old_name}'
            WHERE set_id = (SELECT id FROM sets WHERE code = '{set_code}')
              AND card_number IN ({nums})
              AND name = '{new_name}'
        """)
