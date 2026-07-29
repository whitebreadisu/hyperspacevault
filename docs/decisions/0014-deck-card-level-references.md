# ADR-0014: Decks reference cards, not printings — anchored on non-token root numbers

## Status
Accepted — 2026-07-13

## Context
The Decks feature (App Spec §15) must interoperate with the SWU ecosystem, where every deck format inspected identifies cards as `"SET_NUM"` strings with no finish/foil/variant field (live-verified on SWUBase and sw-unlimited-db.com; confirmed as the normalization target in Karabast's open-source client — BL-110 report). Our catalog, by contrast, is keyed at *variant* granularity because inventory cares which printing you own.

Alternatives considered:
- **Variant-level deck references** (deck rows point at `card_variants`): would let a deck record "I play the Showcase copy," but no external format can express that, so every import would have to invent a variant choice and every export would discard it — permanent impedance mismatch for a distinction decks don't semantically need.
- **Name-based references**: cross-set reprints collide on names; rejected outright (same reasoning as the inventory-format research, BL-109 §4).
- **Raw `(set, number)` against all variants**: unsafe in our own data — 83 collision groups exist across all variants (tokens sharing real cards' numbers; Prestige/foil variant ranges; judge/promo stamps).

The empirical pass that settled it (2026-07-13, full live catalog): collision groups number 83 overall and 45 among non-token cards, but **zero among non-token Standard roots**. Foil pairs share the root's printed number; distinct finishes carry their own numbers — which also dissolved the apparent contradiction between swuapi's docs and our variant-mapping spec (both true, of different variant classes).

## Decision
`deck_cards` rows reference `base_cards` (the card design), never a variant. Inbound `SET_NUM` resolution: match **non-token root numbers** (`base_cards.base_card_number`), fall back to the exceptions-list roots, and report anything else unresolved — never guess. Outbound ids are `SET_zero-padded-3-number`. The zero-collision fact becomes a catalog invariant test, not a standing assumption.

## Consequences
- + Lossless round-trip with the entire de facto ecosystem; imports resolve 1:1 by construction.
- + Deck-to-inventory linkage stays clean: "owned toward this deck" sums all variants of the base card (App Spec §15.7).
- − A deck cannot record which physical printing fills a slot; copy-assignment, if ever wanted, is a v2 layer on top (explicitly deferred, not designed away).
- − The resolution rule depends on a data property ("no non-token root collisions") that future sets could break — accepted with a tripwire: the invariant test fails loudly at ingestion time rather than corrupting imports silently.
