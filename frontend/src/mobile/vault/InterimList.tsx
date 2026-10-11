import { useEffect, useState } from "react";
import { getBaseCardsList } from "../../api/baseCards";
import type { BaseCardCatalog } from "../../api/baseCards";

// BL-247 stage 1a-s SCAFFOLD -- deleted by S1-19 (stage 1b), which replaces it
// with the real rows, the shared data hook (S1-12) and the status rows. It
// exists only so the header collapse (S1-06) has a real, scrollable catalogue
// list under it: one plain line per card, set and number then name.

export function InterimList() {
  const [cards, setCards] = useState<BaseCardCatalog[]>([]);
  useEffect(() => {
    let live = true;
    getBaseCardsList()
      .then((c) => {
        if (live) setCards(c);
      })
      .catch(() => {
        /* scaffold: an empty list is fine */
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="m-interim">
      {cards.map((c) => (
        <div key={c.id} className="m-interim__row">
          <span className="m-interim__num">
            {c.set_code} {c.base_card_number}
          </span>
          <span className="m-interim__name">{c.name}</span>
        </div>
      ))}
    </div>
  );
}
