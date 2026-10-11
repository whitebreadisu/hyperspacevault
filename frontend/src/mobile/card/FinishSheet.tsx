import { useSyncExternalStore } from "react";
import { parseCardDisplay } from "../../utils/catalog";
import { getPlaysetSize } from "../../utils/inventory";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { scopeShortName } from "../../utils/variantScope";
import { SWUButton } from "../../components/SWUButton";
import { Sheet, useSheetClose } from "../Sheet";
import { Playset } from "../vault/Playset";
import { useVaultData } from "../vault/useVaultData";
import { orderPrintings } from "./cardDetailModel";
import "./card.css";

// BL-248 S2-10 (R5-1): Owned by finish -- the touch replacement for desktop's
// hover dossier (PlaysetCell.tsx gallery-dossier, GalleryGrid
// ownedFinishBreakdown), rev4 MSheet.jsx FinishSheet with the round-5 rows:
//   - title = the card (name + subtitle), X top-right (Sheet);
//   - head = "Owned by finish" + the card's count chip + pips exactly as the
//     Vault row draws them unscoped (the S1 Playset component, scope null);
//   - one row per printing, owned or not, in desktop's rail order: finish
//     short name, set / number, then that printing's own count chip (neutral
//     at every count) + pips sized to the card's playset (0 = zero chip +
//     empty grey pips; short = amber filled; at a playset = green pips
//     inside the amber-outlined plate -- playset__pips--scoped-complete);
//   - the words line stays (rev4 ownWords), the "N other printings not
//     owned" footer is gone; "Open card" stays when the sheet was opened
//     from a Vault row.
// Opened from the Vault row's playset cluster (via the small store below,
// hosted by MobileApp so the Vault needs no new state) and from the card
// detail's plate (rendered by CardDetail with the stepper's live counts).

const finishLabel = (v: InventoryVariant) => scopeShortName(v.finish ?? v.variant_type);

/** rev4 MPrimitives ownWords, over the card's playset size. */
export function ownWords(owned: number, size: number): string {
  if (owned === 0) return "Not owned";
  if (owned < size) return `${size - owned} short of a playset`;
  if (owned === size) return size === 1 ? "Owned" : "Playset complete";
  return `${owned - size} over keep limit`;
}

function PrintingPips({ qty, size }: { qty: number; size: number }) {
  const filled = Math.min(size, qty);
  const complete = qty >= size;
  return (
    <span
      className={
        "playset m-pips m-pips--chip m-dossier__pips" + (qty === 0 ? " playset--empty" : "")
      }
      data-qty={qty}
    >
      <span className="playset-chip">{qty}</span>
      <span className={"playset__pips" + (complete ? " playset__pips--scoped-complete" : "")}>
        {Array.from({ length: size }, (_, i) => (
          <span
            key={i}
            className={
              "playset__pip" + (i < filled ? " playset__pip--filled playset__pip--scoped" : "")
            }
          />
        ))}
      </span>
    </span>
  );
}

function OpenCard({ onOpen }: { onOpen: () => void }) {
  const close = useSheetClose();
  return (
    <div className="m-dossier__open">
      <SWUButton
        size="md"
        className="m-swu-full"
        onClick={() => {
          close();
          onOpen();
        }}
      >
        Open card
      </SWUButton>
    </div>
  );
}

export function FinishSheet({
  card,
  qtyOf,
  onOpenCard,
  onClose,
}: {
  card: InventoryCard;
  /** The count to show per printing (the detail's stepper while it is open). */
  qtyOf?: (v: InventoryVariant) => number;
  onOpenCard?: () => void;
  onClose: () => void;
}) {
  const { displayName, subtitle } = parseCardDisplay(card);
  const size = getPlaysetSize(card.type);
  const q = qtyOf ?? ((v: InventoryVariant) => card.inventory[v.variant_id] ?? 0);
  const ordered = orderPrintings(card.variants, card.set_code);
  const owned = ordered.reduce((s, v) => s + q(v), 0);
  // The head chip reads the same counts as the rows.
  const headCard: InventoryCard = qtyOf
    ? { ...card, inventory: Object.fromEntries(card.variants.map((v) => [v.variant_id, q(v)])) }
    : card;
  return (
    <Sheet
      title={displayName}
      sub={subtitle || undefined}
      labelId="sheet-finish"
      className="m-sheet-layer--finish"
      onClose={onClose}
    >
      <div className="m-dossier" data-card={card.base_card_id}>
        <div className="m-dossier__head">
          <span className="m-dossier__label">Owned by finish</span>
          <Playset card={headCard} scope={null} isAuthenticated />
        </div>
        {ordered.map((v) => (
          <div key={v.variant_id} className="m-dossier__row" data-variant={v.variant_id}>
            <span className="m-dossier__finish">{finishLabel(v)}</span>
            <span className="m-dossier__num">
              {v.source_set_code} {v.card_number}
            </span>
            <PrintingPips qty={q(v)} size={size} />
          </div>
        ))}
        {owned > 0 ? <div className="m-dossier__foot">{ownWords(owned, size)}</div> : null}
      </div>
      {onOpenCard ? <OpenCard onOpen={onOpenCard} /> : null}
    </Sheet>
  );
}

// ── The Vault row's opener (S1-19 left the hook; R5-1) ────────────────────
interface Request {
  cardId: number;
  open: () => void;
}
let request: Request | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Open Owned by finish for a card from the Vault; `open` opens its detail
 * exactly as the row tap would (the Vault's list + printing). */
export function openFinishSheet(cardId: number, open: () => void): void {
  request = { cardId, open };
  emit();
}

export function FinishSheetHost() {
  const req = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => request
  );
  const { cards } = useVaultData();
  const card = req ? cards.find((c) => c.base_card_id === req.cardId) : null;
  if (!req || !card) return null;
  return (
    <FinishSheet
      card={card}
      onOpenCard={req.open}
      onClose={() => {
        request = null;
        emit();
      }}
    />
  );
}
