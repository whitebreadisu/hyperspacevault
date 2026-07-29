"""BL-137 D3: the three-scope buildability diff
(Definition_DeckCheck_2026-07-16.md §4). Pure -- operates on plain dicts of
base_card_id -> int, no DB/ORM, so the named acceptance case is a
one-function unit test with no fixtures.

Sequential math: main scope runs against the full owned quantity; side
scope runs against owned quantity MINUS whatever main *needed* (not
"actually has" -- the full main requirement is reserved regardless of
whether the collector can meet it, so an unmet main need never frees up
phantom copies for the side scope). Together is main AND side, reported
explicitly as its own scope per the API contract rather than left for the
caller to derive.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MissingEntry:
    base_card_id: int
    need: int
    have: int


@dataclass(frozen=True)
class ScopeDiff:
    buildable: bool
    missing: list[MissingEntry]


def _diff_against(needs: dict[int, int], owned: dict[int, int]) -> ScopeDiff:
    missing: list[MissingEntry] = []
    for base_card_id, need in needs.items():
        have = owned.get(base_card_id, 0)
        if have < need:
            missing.append(
                MissingEntry(base_card_id=base_card_id, need=need, have=have)
            )
    return ScopeDiff(buildable=not missing, missing=missing)


def remaining_after_main(
    main_needs: dict[int, int], owned: dict[int, int]
) -> dict[int, int]:
    """Owned quantities after reserving whatever main *needs* (not what it
    actually has) -- the sequential math's middle step, exposed publicly
    (BL-142) so the ALL CARDS full-card-list build can compute the side
    scope's 'have' baseline the same way the missing-only diff already
    does, without re-deriving or duplicating the reservation rule."""
    return {
        base_card_id: max(qty - main_needs.get(base_card_id, 0), 0)
        for base_card_id, qty in owned.items()
    }


def diff_scopes(
    main_needs: dict[int, int],
    side_needs: dict[int, int],
    owned: dict[int, int],
) -> tuple[ScopeDiff, ScopeDiff, ScopeDiff]:
    """`owned` is the finish-agnostic total quantity per base_card_id
    (app.repositories.deck_check.get_owned_quantities already sums across
    every variant/printing before this function ever sees it). Returns
    (main, side, together).

    Named acceptance case (Definition_DeckCheck §4): main_needs={X: 2},
    side_needs={X: 1}, owned={X: 2} -> main buildable (2 of 2), side NOT
    (0 of 1 remaining after main's 2 are reserved), together NOT.
    """
    main_diff = _diff_against(main_needs, owned)
    side_diff = _diff_against(side_needs, remaining_after_main(main_needs, owned))

    together_diff = ScopeDiff(
        buildable=main_diff.buildable and side_diff.buildable,
        missing=main_diff.missing + side_diff.missing,
    )
    return main_diff, side_diff, together_diff


def full_entries(needs: dict[int, int], owned: dict[int, int]) -> list[MissingEntry]:
    """BL-142: every card in a needs pool, not just the missing ones -- the
    ALL CARDS toggle needs owned/fully-owned rows alongside missing rows to
    render a complete deck list. Reuses MissingEntry's (base_card_id, need,
    have) shape (a card with have >= need is simply a non-missing entry
    here, unlike _diff_against which drops it entirely). `owned` is
    whichever baseline the caller's scope uses -- raw owned for main,
    remaining_after_main(...) for side, matching diff_scopes exactly so the
    full list's 'have' values agree with the missing-only diff's."""
    return [
        MissingEntry(
            base_card_id=base_card_id, need=need, have=owned.get(base_card_id, 0)
        )
        for base_card_id, need in needs.items()
    ]
