"""BL-137 D1: parses the de facto deck-interop JSON shape (BL-110 §2a,
confirmed live against SWUBase + sw-unlimited-db.com; SWU_Application_Spec.md
§15.5) into a small internal dataclass shape. Pure/DB-free -- no catalog
lookups happen here, that's deck_resolution.py's job (D1 continued).

Shape accepted: {metadata?: {name?, author?}, leader: {id,count},
secondleader?: {id,count}|null, base: {id,count}, deck: [{id,count},...],
sideboard?: [{id,count},...]}. Unknown keys (e.g. sw-unlimited-db's
per-card "unit" tag) are ignored by construction -- _parse_card_ref only
ever reads "id"/"count" off a dict, everything else on that dict is simply
never looked at.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class InvalidDeckJsonError(Exception):
    """Raised with a specific, user-facing reason -- the router maps this to
    the `invalid_deck_json` typed error (Definition_DeckCheck_2026-07-16.md
    §6), never a generic 422 with no explanation."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True)
class DeckCardRef:
    """One `{id, count}` line from the incoming JSON, still an unresolved
    raw SET_NUM string at this stage."""

    id: str
    count: int


@dataclass(frozen=True)
class ParsedDeck:
    name: str | None
    author: str | None
    leader: DeckCardRef
    base: DeckCardRef
    second_leader: DeckCardRef | None
    main: list[DeckCardRef] = field(default_factory=list)
    sideboard: list[DeckCardRef] = field(default_factory=list)


def _parse_card_ref(raw: object, field_name: str) -> DeckCardRef:
    if not isinstance(raw, dict):
        raise InvalidDeckJsonError(f"'{field_name}' must be an object with id/count")
    card_id = raw.get("id")
    count = raw.get("count")
    if not isinstance(card_id, str) or not card_id.strip():
        raise InvalidDeckJsonError(f"'{field_name}.id' must be a non-empty string")
    # bool is a subclass of int in Python -- explicitly excluded so
    # {"id": "SOR_024", "count": true} doesn't silently parse as count=1.
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise InvalidDeckJsonError(f"'{field_name}.count' must be a positive integer")
    return DeckCardRef(id=card_id.strip(), count=count)


def _parse_optional_card_ref(raw: object, field_name: str) -> DeckCardRef | None:
    if raw is None:
        return None
    return _parse_card_ref(raw, field_name)


def _parse_card_ref_list(raw: object, field_name: str) -> list[DeckCardRef]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise InvalidDeckJsonError(f"'{field_name}' must be a list")
    return [_parse_card_ref(item, f"{field_name}[{i}]") for i, item in enumerate(raw)]


def parse_deck_json(raw: object) -> ParsedDeck:
    """Validates and parses one deck payload. Raises InvalidDeckJsonError
    with a specific reason on any structural problem -- never guesses or
    silently drops a malformed entry."""
    if not isinstance(raw, dict):
        raise InvalidDeckJsonError("deck payload must be a JSON object")

    metadata = raw.get("metadata")
    if metadata is None:
        metadata = {}
    if not isinstance(metadata, dict):
        raise InvalidDeckJsonError("'metadata' must be an object")
    name = metadata.get("name")
    author = metadata.get("author")

    if "leader" not in raw:
        raise InvalidDeckJsonError("missing 'leader'")
    if "base" not in raw:
        raise InvalidDeckJsonError("missing 'base'")
    if "deck" not in raw:
        raise InvalidDeckJsonError("missing 'deck'")

    leader = _parse_card_ref(raw.get("leader"), "leader")
    base = _parse_card_ref(raw.get("base"), "base")
    second_leader = _parse_optional_card_ref(raw.get("secondleader"), "secondleader")
    main = _parse_card_ref_list(raw.get("deck"), "deck")
    sideboard = _parse_card_ref_list(raw.get("sideboard"), "sideboard")

    return ParsedDeck(
        name=name if isinstance(name, str) and name.strip() else None,
        author=author if isinstance(author, str) and author.strip() else None,
        leader=leader,
        base=base,
        second_leader=second_leader,
        main=main,
        sideboard=sideboard,
    )
