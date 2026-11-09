import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { SectionSeparator } from "../../components/SectionSeparator";
import { SWUButton } from "../../components/SWUButton";
import type { Stash } from "../../api/stashes";
import { PencilIcon } from "../../screens/stashes/stashIcons";
import { useStashes } from "../../stashes/StashContext";
import { STASH_COPY, usePrintingIndex, useStashValues } from "../../stashes/stashContents";
import { useStashMeta } from "../../stashes/useStashMeta";
import { formatMoney } from "../../utils/completion";
import { formatVersionLabel } from "../../utils/version";
import { useVaultData } from "../../vault/useVaultData";
import { BrandLogo } from "../BrandLogo";
import { usePriceKind } from "../priceKind";
import { go } from "../router";
import { PriceSeg } from "../vault/CompletionHeader";
import { CreateStashSheet, DeleteStashSheet, EditStashSheet } from "./StashSheets";
import "../more/more.css";
import "./stashes.css";

// The phone Stashes screen at #/stashes (design 1d A): the app header, the
// "Stashes" title (no back arrow, no X: it is a Vault subsection, reached
// from the bottom bar's Vault menu), "Your stashes" with Market | Low, one
// row per stash in creation order (name + description · copies over value ·
// pencil; the row opens the stash, the pencil the Edit sheet; no chevron,
// R2-8),
// then New stash. No stashes: one sentence and New stash.

const VERSION = formatVersionLabel(__APP_VERSION__);

type SheetState = { kind: "edit" | "delete"; stash: Stash } | { kind: "create" } | null;

export function StashesScreen({
  account,
  unread,
  onOpenChooser,
}: {
  account: ReactNode;
  unread: boolean;
  onOpenChooser: () => void;
}) {
  const ctx = useStashes();
  const { cards } = useVaultData();
  const [priceKind, setPriceKind] = usePriceKind();
  const meta = useStashMeta();
  const [sheet, setSheet] = useState<SheetState>(null);

  const values = useStashValues(usePrintingIndex(cards), ctx, priceKind);

  const newButton = (
    <div className="m-stashes__new">
      <SWUButton
        size="touch"
        onClick={() => {
          meta.clearError();
          setSheet({ kind: "create" });
        }}
      >
        New stash
      </SWUButton>
    </div>
  );

  return (
    <div className="m-screen m-more m-stashes">
      <header
        className="m-more__hdr"
        style={
          {
            "--starfield": 'var(--header-starfield, url("/images/starfields/starfield_ASH.jpg"))',
          } as CSSProperties
        }
      >
        <div className="m-more__sky" aria-hidden="true" />
        <div className="m-more__top">
          <button
            type="button"
            className="m-more__brand"
            onClick={onOpenChooser}
            aria-label="Hyperspace Vault: About & Legal, Updates"
          >
            <BrandLogo />
            <span
              className={"m-vh__tag" + (unread ? " m-cue m-cue--tag" : "")}
              data-cue={`UNOFFICIAL FAN PROJECT [${VERSION}]`}
            >
              Unofficial Fan Project [<span className="m-vh__ver">{VERSION}</span>]
            </span>
          </button>
          {account}
        </div>
      </header>
      <SectionSeparator className="m-more__sep" />
      <div className="m-scroll m-more__scroll">
        <header className="m-shell__head m-stashes__head">
          <span className="m-shell__bal" aria-hidden="true" />
          <h1 className="m-shell__title">Stashes</h1>
          <span className="m-shell__bal" aria-hidden="true" />
        </header>
        {!ctx.ready && ctx.failed ? (
          <p className="m-stashes__note" role="alert">
            {STASH_COPY.loadFailed}{" "}
            <button type="button" className="m-stashok__undo" onClick={() => void ctx.retry()}>
              {STASH_COPY.retry}
            </button>
          </p>
        ) : !ctx.ready ? (
          <p className="m-stashes__note">{STASH_COPY.loading}</p>
        ) : ctx.stashes.length === 0 ? (
          <div className="m-stashes__empty">
            <p className="m-stashes__emptytext">{STASH_COPY.empty}</p>
            {newButton}
          </div>
        ) : (
          <section className="m-stashes__group" aria-label="Your stashes">
            <div className="m-summary__head m-stashes__grouphead">
              <h2 className="m-summary__label m-stashes__label">Your stashes</h2>
              <PriceSeg mode={priceKind} onChange={setPriceKind} />
            </div>
            {ctx.stashes.map((s) => (
              <div key={s.id} className="m-stashrow" data-stash={s.id}>
                <button
                  type="button"
                  className="m-stashrow__main"
                  onClick={() => go("#/stashes/" + s.id)}
                  aria-label={`${s.name}, ${s.copies} ${s.copies === 1 ? "copy" : "copies"}`}
                >
                  <span className="m-stashrow__text">
                    <span className="m-stashrow__name">{s.name}</span>
                    {s.description ? (
                      <span className="m-stashrow__desc">{s.description}</span>
                    ) : null}
                  </span>
                  <span className="m-stashrow__nums">
                    <span
                      className={
                        "m-stashrow__copies" + (s.copies === 0 ? " m-stashrow__copies--zero" : "")
                      }
                    >
                      {s.copies}
                    </span>
                    <span className="m-stashrow__value">
                      {s.copies === 0 ? "—" : formatMoney(values.get(s.id) ?? 0)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="m-stashrow__pencil"
                  aria-label={`Edit ${s.name}: name and description`}
                  onClick={() => {
                    meta.clearError();
                    setSheet({ kind: "edit", stash: s });
                  }}
                >
                  <PencilIcon size={17} />
                </button>
              </div>
            ))}
            {newButton}
          </section>
        )}
      </div>
      {sheet?.kind === "edit" ? (
        <EditStashSheet
          stash={sheet.stash}
          meta={meta}
          onClose={() => setSheet(null)}
          onDelete={() => {
            meta.clearError();
            setSheet({ kind: "delete", stash: sheet.stash });
          }}
        />
      ) : null}
      {sheet?.kind === "delete" ? (
        <DeleteStashSheet stash={sheet.stash} meta={meta} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "create" ? (
        <CreateStashSheet meta={meta} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  );
}
