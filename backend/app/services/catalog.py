"""The public catalog reference CSV (App Spec §17.3) -- the resolution key
space (swuapi_uuid + set_code/card_number/variant_type) for every card
printing, published so a user can hand-author an import file. Public/
tenant-less (ADR-0008), same exposure class as GET /api/sets."""

import csv
import io
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.repositories import cards as card_repo
from app.services.set_order import export_sort_key

REFERENCE_FILENAME_STEM = "hyperspacevault-catalog-reference"

# Fixed column order for the reference CSV -- no meta line (this is a plain
# reference table, not an inventory export; the import still accepts it
# because the header carries quantity plus both identity schemes, see
# inventory_io.parse_csv). `quantity` is prefilled 0 in the exact position
# the export writes it (inventory_io.CSV_COLUMNS) -- a user types quantities
# into their rows and imports the file as-is; the untouched 0 rows are
# no-ops under merge (App Spec §17.3).
REFERENCE_COLUMNS = [
    "swuapi_uuid",
    "set_code",
    "card_number",
    "variant_type",
    "quantity",
    "name",
    "subtitle",
]


def get_reference_csv(db: Session) -> tuple[str, str]:
    """Returns (csv_content, filename). One row per card_variants row, in
    the Vault-matching file order (set_order.export_sort_key)."""
    rows = sorted(
        card_repo.get_catalog_reference_rows(db),
        key=lambda r: export_sort_key(r.source_set_code, r.card_number, r.variant_type),
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(REFERENCE_COLUMNS)
    for r in rows:
        writer.writerow(
            [
                r.swuapi_id,
                r.source_set_code,
                r.card_number,
                r.variant_type,
                0,
                r.name,
                r.subtitle or "",
            ]
        )
    content = buffer.getvalue()

    date_str = datetime.now(UTC).strftime("%Y-%m-%d")
    filename = f"{REFERENCE_FILENAME_STEM}_{date_str}.csv"
    return content, filename
