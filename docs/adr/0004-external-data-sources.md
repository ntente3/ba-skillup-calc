# ADR 0004 — Which external sources are usable

Status: accepted

## Context

Four candidate sources were evaluated for icons, new-student data, and stable ids.

| Candidate | Programmatic access | License |
|---|---|---|
| bluearchive.wiki | `api.php` **403**, `robots.txt` also 403 | — |
| bluearchive.fandom.com | `api.php` **402** (paywalled) | not stated |
| bluearchive.gg | no API, prose guides | not stated |
| bluearchive.wikiru.jp | no API | not stated |

`bluearchive.wikiru.jp/robots.txt` explicitly denies `GPTBot` and `Google-Extended` with
`Disallow: /`.

## Decision

None of the four are used for bulk automated collection. Two block bots (one naming AI
crawlers), one paywalled its API, one is not structured data, and none state terms
permitting redistribution.

`Dimbreath/BlueArchiveData` is **DMCA-blocked** and is not used or worked around.
`dungdinhmanh/blue-archive-data` mirrors SchaleDB, so it cannot serve as a cross-check.

SchaleDB's repository was archived in June 2025, so it is not relied on for student ids —
that would undermine [0002](0002-state-identity.md).

## What is used instead

**Icons come from the source workbook.** It already contains 356 in-cell images (Excel
rich values), placed directly under the material name headers, so labels come with them.
`scripts/extract_icons.py` follows cell `vm` → `metadata.xml` → `rdrichvalue` →
`richValueRel` → `media` and extracts 158 (orbs 80/80, gear 78/81; the source lacks 3).

**New students still come from the workbook**, which a person updates. Automating that
would need a stable structured source, and none qualifies.

Later revisions ([0005](0005-tags-and-pending.md), [0008](0008-three-way-crosscheck.md))
added narrow, verifiable uses of SchaleDB and bluearchive.wiki — attribute tags and value
cross-checks — under their respective access rules.

## Copyright

Icons are NEXON/Yostar assets wherever they come from. Extracting from the workbook avoids
a wiki's terms and robots policy and avoids free-riding on someone else's curation, but it
does not change the copyright. Attribution and non-affiliation are stated in the README.
