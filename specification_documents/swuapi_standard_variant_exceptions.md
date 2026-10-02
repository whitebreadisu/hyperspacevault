# Standard Variant Mapping — Current Exceptions

**Last generated:** 2026-10-02 (BL-239 content refresh; table section as `render_exceptions_doc()` renders an empty set).

**Definition (refined 2026-06-21, per BL-27):** a card is a standard-anchor exception if and only if it is a root (`variant_of_uuid: null`) whose own `variant_type` is **not** "Standard" **and** it has **no unique non-token `(name, subtitle)` match** to a Standard root elsewhere in the corpus (i.e. the fallback below cannot resolve it). See [`SWU_Standard_Variant_Mapping_Spec.md`](SWU_Standard_Variant_Mapping_Spec.md) §6 for the full definition and philosophy.

The 2026-06-21 census found **15** structural non-`"Standard"` roots. Per Jeremy's BL-27 decision, **14 are treated as swuapi data errors** (an unpopulated `variant_of_uuid` link) and **re-anchored** to their Standard printing via a case-insensitive `(name, subtitle)` fallback at ingestion — they are *not* exceptions. One of those 14, `GG_5 Experience`, is a **duplicate-per-set token** (matched 7 Standards) and stays its own `base_card` per redesign spec §3.4. Full diagnostic detail for all 15 is in `swuapi_standard_variant_exceptions_review_2026-06-21.md`.

## Current exceptions (0)

_None — every non-Standard root resolved via the §6 fallback._

**2026-10-02:** the one standing exception, `C26_3` Zam Wesell "Not What She Seems", left this list when upstream populated its `variant_of_uuid` (→ `HMW_134`). Prior table: `SWU_Application_Spec_Archive.md`.

---

*This file's rendering is produced by BL-29's ingestion script (`render_exceptions_doc()`/`regenerate_exceptions_doc()`, `swuapi_transform.py`) but is **not** wired into `run_swuapi_ingestion.py` — corrected 2026-07-24 (BL-150 W1); the prior "regenerated on each run" claim was wrong (runbook Scenario E, first confirmed at the 2026-07-14 live execution). Invoke `regenerate_exceptions_doc()` explicitly if a run's exception set differs from the table above. A card lands here only if the §6 fallback finds no unique non-token Standard match.*
