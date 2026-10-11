import type {
  CapHandling,
  ImportMode,
  ImportRowCard,
  ImportRowReport,
} from "../../api/inventoryImportExport";

// BL-250 S4-11: FORK of the module-private copy and helpers in desktop
// screens/importexport/ImportPreviewReport.tsx (REASON_TEXT, GENERIC_REASON_TEXT,
// candidateLabel, MISMATCH_TEXT, cardLabel) and ImportExportPage.tsx
// (problemRowsCsv, MODE/CAP options, fileFormat). Copied unchanged -- desktop
// is not edited (brief rule 7); BL-254 folds the forks back into one source.

export interface ReasonCopy {
  error: string;
  recommendation: string;
}

export const REASON_TEXT: Record<string, ReasonCopy> = {
  malformed_row: {
    error: "This row's quantity isn't a number we can use.",
    recommendation:
      "Fix it in the file to a whole number (0 or more) and re-import — everything else went through fine.",
  },
  unknown_uuid_and_triple: {
    error:
      "We couldn't find this card in the catalog — neither its ID nor its set/number/printing matched anything.",
    recommendation:
      "Check the row against the catalog reference sheet, or it may be from a set we don't carry yet.",
  },
  unknown_triple: {
    error: "No card in the catalog matches that set, number, and printing.",
    recommendation:
      "Double-check the row against the catalog reference sheet — it's usually a number or printing-type typo.",
  },
  incomplete_identity: {
    error: "This row doesn't say enough about which card it is.",
    recommendation:
      "Fill in the card's ID, or all three of set, number, and printing type, and re-import.",
  },
  unmapped_set: {
    error:
      "We don't recognize this file's set code (or promo series) yet, so we can't tell which card it is.",
    recommendation:
      "Add these by hand in your Vault for now — and tell us the set code via Feedback so we can teach the importer.",
  },
  unknown_set_and_number: {
    error: "We know that set, but there's no card at that number.",
    recommendation:
      "Double-check the card number — and note that token cards can't be imported from SWUDB files.",
  },
  unmapped_column: {
    error:
      "This copy is logged under a promo column (like Judge or Event Exclusive) that we can't safely match to a specific printing.",
    recommendation:
      "Add these few cards by hand in your Vault — everything in the regular columns imports normally.",
  },
  unknown_variant_for_column: {
    error:
      "We found the spot in the spreadsheet, but no printing of that card matches this column (and sometimes the card number itself is off).",
    recommendation:
      "Check the card number and which column the quantity is in against the card's real printings.",
  },
  ambiguous_triple: {
    error: "This row matches more than one printing of the same card, and we don't guess.",
    recommendation:
      "Let the rest import, then add this card by hand from your Vault — the possible printings are listed below.",
  },
};

/** BL-200: the `?? row.reason` fallback used to render a raw snake_case
 * code verbatim whenever REASON_TEXT was missing an entry -- now that every
 * reason code the backend sends is covered above, this only fires for a
 * future/unrecognized code this build doesn't know about yet, but it must
 * still never show system vocabulary. Not itself drafted in the BL-200
 * census (every code it censused now has a real entry above); written to
 * match the census's stated voice (casual-but-competent, no raw codes). */
export const GENERIC_REASON_TEXT: ReasonCopy = {
  error: "This row couldn't be imported, and we don't have a more specific reason to show yet.",
  recommendation: "It's safe to skip for now — everything else in the file still went through.",
};

/** BL-200 candidate display: "SET number · variant type · name", subtitle
 * appended when present -- the ambiguous-row candidates used to render as
 * bare swuapi UUIDs (see the census's "Candidate display" section). */
export function candidateLabel(card: ImportRowCard): string {
  const identity = [card.set_code, card.card_number].filter(Boolean).join(" ");
  const parts = [identity, card.variant_type].filter((p): p is string => !!p);
  let name = card.name ?? "";
  if (card.subtitle) name = name ? `${name} — ${card.subtitle}` : card.subtitle;
  if (name) parts.push(name);
  return parts.join(" · ");
}

/** BL-200 §C2: the resolved-row "heads-up" flag used to hardcode "uuid/
 * triple mismatch" for every format, which was actively wrong for SWUDB/
 * XLSX rows (they never carried a uuid or a triple -- their mismatch is a
 * foil/stamp disagreement instead). The census's own recommendation is one
 * honest string that covers both without naming uuid/triple/foil internals
 * ("if the owner wants precision later, the flag would need a format-aware
 * split in the payload" -- not requested yet), so this replaces the old
 * per-format-wrong string rather than branching on format. */
export const MISMATCH_TEXT =
  "heads-up — some details in this row didn't fully agree, so double-check it landed on the right printing";

/** §7.3's `card` fragment renders as whatever identity the row actually
 * carried -- resolved rows always have set_code/card_number/variant_type
 * (the canonical DB identity); unresolved/ambiguous rows may have only a
 * uuid, only a partial triple, or nothing at all. */
export function cardLabel(card: ImportRowCard): string {
  const identity = [card.set_code, card.card_number].filter(Boolean).join(" ");
  const variant = card.variant_type ? ` (${card.variant_type})` : "";
  const name = card.name ? ` — ${card.name}` : "";
  if (identity) return `${identity}${variant}${name}`;
  if (card.swuapi_uuid) return `uuid ${card.swuapi_uuid}${name}`;
  return "Row with no recognizable identity";
}

/** §8.2c's "Download problem rows (CSV)" button -- built client-side from
 * whatever report is currently on screen (dry_run preview or a commit's
 * still-returned report), never a server round trip. Column set mirrors
 * §7.3's row shape closely enough that a fixed-up file could be re-imported
 * by hand. */
export function problemRowsCsv(rows: ImportRowReport[]): string {
  const header = [
    "row_number",
    "status",
    "reason",
    "set_code",
    "card_number",
    "variant_type",
    "swuapi_uuid",
    "file_quantity",
    "candidates",
  ];
  const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.row_number,
      r.status,
      r.reason ?? "",
      r.card.set_code ?? "",
      r.card.card_number ?? "",
      r.card.variant_type ?? "",
      r.card.swuapi_uuid ?? "",
      r.file_quantity ?? "",
      // BL-200: `candidates` widened from bare uuid strings to full card
      // records (ImportPreviewReport now renders them as real cards) --
      // this CSV column stays UUIDs (the census's own suggested option:
      // "keep UUIDs there since that file is for machine round-trips"),
      // since it's a data file meant for re-import, not a screen read by a
      // person.
      (r.candidates ?? []).map((c) => c.swuapi_uuid ?? "").join("|"),
    ]
      .map(quote)
      .join(",")
  );
  return [header.map(quote).join(","), ...lines].join("\r\n");
}

/** BL-235: import_dry_run/import_committed's `format` -- the uploaded
 * file's extension, distinct from `mode` (merge_add/replace/replace_all,
 * import_committed's own property). */
export function fileFormat(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "unknown";
}

export const MODE_OPTIONS: {
  value: ImportMode;
  title: string;
  description: string;
  destructive?: boolean;
}[] = [
  {
    value: "merge_add",
    title: "Merge (add)",
    description: "Adds the file's quantities on top of what you already own.",
  },
  {
    value: "replace",
    title: "Replace",
    description:
      "The file's quantity wins for every row it lists; rows it doesn't mention are untouched.",
  },
  {
    value: "replace_all",
    title: "Replace All",
    description: "Wipes your entire Vault and loads exactly what's in the file.",
    destructive: true,
  },
];

export const CAP_OPTIONS: { value: CapHandling; label: string }[] = [
  { value: "add_above", label: "Add everything, even above my keep-limits" },
  { value: "trim", label: "Trim to my keep-limits" },
];
