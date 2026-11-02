import { RarityBadge } from "../components/RarityBadge";
import { SectionSeparator } from "../components/SectionSeparator";
import { setLogoSrc, starfieldSrc } from "../mobile/card/cardDetailModel";
import type { IndexPageData, SetPageData } from "./publicCatalog";
import { Breadcrumbs, PageBar, PageFooter } from "./PublicFrame";

// The set pages (`/cards/sor/`) and the set index (`/cards/`), design note §5
// "Internal linking": static pages in the public frame, no hydration. A set
// page lists every non-token card in number order (number, name, rarity, a
// link to its page); the index lists the sets newest first (ADR-0031). Both
// sit in the card detail's steel-ring console shell (.cp-shell / .cp-modal)
// with its starfield header, so they read as the same family as the card
// pages. Each has one <h1>.

function ShellHeader({
  code,
  title,
  aside,
}: {
  code: string | null;
  title: string;
  aside: string;
}) {
  const art = code ? starfieldSrc(code) : null;
  const logo = code ? setLogoSrc(code) : null;
  return (
    <div className="cp-header pc-list__header">
      {art ? (
        <div
          className="cp-header__art"
          style={{
            backgroundImage: `linear-gradient(90deg, rgba(9, 11, 20, 0.62), rgba(9, 11, 20, 0.28)), url(${art})`,
          }}
          aria-hidden="true"
        />
      ) : null}
      <div className="cp-header__row">
        <h1 className="cp-title">{title}</h1>
        <div className="cp-subtitle">{aside}</div>
        {logo ? <img className="cp-header__setlogo" src={logo} alt={`${code} logo`} /> : null}
      </div>
    </div>
  );
}

export function SetPage({ data }: { data: SetPageData }) {
  const count = data.cards.length === 1 ? "1 card" : `${data.cards.length} cards`;
  return (
    <div className="pc-page">
      <PageBar />
      <Breadcrumbs crumbs={[{ label: "Cards", href: "/cards/" }, { label: data.name }]} />
      <div className="cp-shell pc-shell">
        <div className="cp-modal pc-modal">
          <ShellHeader code={data.code} title={data.name} aside={`${data.code} · ${count}`} />
          <SectionSeparator className="cp-separator" />
          <ol className="pc-list" aria-label={`${data.name} cards`}>
            {data.cards.map((c) => (
              <li key={c.path}>
                <a className="pc-list__row" href={c.path}>
                  <span className="pc-list__num">{c.numberLabel}</span>
                  <span className="pc-list__name">
                    {c.name}
                    {c.subtitle ? <span className="pc-list__sub"> - {c.subtitle}</span> : null}
                  </span>
                  <span className="pc-list__rarity">
                    <RarityBadge rarity={c.rarity} size={20} />
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <PageFooter />
    </div>
  );
}

export function CardsIndexPage({ data }: { data: IndexPageData }) {
  const sets = data.sets.length === 1 ? "1 set" : `${data.sets.length} sets`;
  return (
    <div className="pc-page">
      <PageBar />
      <Breadcrumbs crumbs={[{ label: "Cards" }]} />
      <div className="cp-shell pc-shell">
        <div className="cp-modal pc-modal">
          <ShellHeader
            code={null}
            title="Star Wars: Unlimited card list"
            aside={`${sets} · ${data.total} cards`}
          />
          <SectionSeparator className="cp-separator" />
          <ol className="pc-list pc-list--sets" aria-label="Sets, newest first">
            {data.sets.map((s) => {
              const logo = setLogoSrc(s.code);
              return (
                <li key={s.code}>
                  <a className="pc-list__row pc-list__row--set" href={s.path}>
                    <span className="pc-list__logo">
                      {logo ? <img src={logo} alt="" loading="lazy" /> : null}
                    </span>
                    <span className="pc-list__name">{s.name}</span>
                    <span className="pc-list__num">{s.code}</span>
                    <span className="pc-list__count">
                      {s.count === 1 ? "1 card" : `${s.count} cards`}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <PageFooter />
    </div>
  );
}
