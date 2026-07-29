"""BL-137 D1: pure unit tests for parse_set_num (app/services/
deck_resolution.py) -- the SET_NUM string parser, independent of any DB
lookup. DB-free."""

from app.services.deck_resolution import parse_set_num

KNOWN_CODES = frozenset(
    {"SOR", "SHD", "TWI", "JTL", "LOF", "SEC", "LAW", "ASH", "TS26", "C26"}
)


def test_parses_underscore_zero_padded():
    assert parse_set_num("SOR_024", KNOWN_CODES) == ("SOR", 24)


def test_parses_underscore_unpadded():
    assert parse_set_num("SOR_162", KNOWN_CODES) == ("SOR", 162)


def test_parses_no_underscore():
    assert parse_set_num("SOR162", KNOWN_CODES) == ("SOR", 162)


def test_parses_extra_zero_padding():
    assert parse_set_num("SOR_0024", KNOWN_CODES) == ("SOR", 24)


def test_lowercase_input_accepted():
    assert parse_set_num("sor_024", KNOWN_CODES) == ("SOR", 24)


def test_digit_bearing_set_code_resolves_correctly():
    """TS26/C26 contain digits themselves -- a fixed alpha/digit boundary
    regex would misparse "TS26_3"; matching against known set codes
    (longest first) avoids the ambiguity."""
    assert parse_set_num("TS26_3", KNOWN_CODES) == ("TS26", 3)
    assert parse_set_num("C26_3", KNOWN_CODES) == ("C26", 3)


def test_unknown_set_code_returns_none():
    assert parse_set_num("ZZZ_999", KNOWN_CODES) is None


def test_token_id_returns_none():
    """A token's collector_number carries a "_T" prefix (e.g. ASH_T001) --
    the remainder after the set code isn't pure digits, so it never
    resolves. Tokens are never deck-citable in practice (BL-110 §4), but
    if one somehow appeared it must land in unrecognized, never guess a
    nearby real card."""
    assert parse_set_num("ASH_T001", KNOWN_CODES) is None


def test_blank_id_returns_none():
    assert parse_set_num("   ", KNOWN_CODES) is None


def test_set_code_with_no_trailing_number_returns_none():
    assert parse_set_num("SOR_", KNOWN_CODES) is None
    assert parse_set_num("SOR", KNOWN_CODES) is None
