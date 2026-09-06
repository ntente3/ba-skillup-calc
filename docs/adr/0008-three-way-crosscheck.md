# ADR 0008 — Resolving disputes with a third source

Status: accepted

## The question

[0007](0007-opart-verification.md) left 61 values where the workbook and SchaleDB disagreed.
Two sources cannot settle which is right.

## Third source

`bluearchive.wiki` (Miraheze, **CC BY-SA 4.0**), community-maintained and independent of
SchaleDB.

Access rules were respected: its `robots.txt` disallows `/w/` (the API) but permits
`/wiki/` (articles), so only articles were read, one request per 1.5 s, only for the
students in dispute.

**Not used**: `Dimbreath/BlueArchiveData` is DMCA-blocked. `dungdinhmanh/blue-archive-data`
mirrors SchaleDB and so cannot cross-check it.

Icon filenames correspond exactly to SchaleDB's `Icon` field
(`Item_Icon_Material_Nimrud_0.png` ↔ `item_icon_material_nimrud_0` ↔ item 130), so no
mapping table was needed.

## Verdict

**130 comparisons. Every one sided with SchaleDB. Zero counterexamples.** The workbook had
data-entry errors.

The clearest cases are "same quantity, adjacent material" — one student's 33 units recorded
against the neighbouring material, another's 30 likewise. Adjacent material blocks sit four
columns apart in the sheet; that is what a paste into the wrong column looks like.

One student had no wiki article, so the maintainer supplied a table from another Korean wiki
by hand: **11/11 matching**, with the workbook alone differing on one material. It is
recorded in `MANUAL_CONFIRMED` with its justification.

A side confirmation: that table shows normal skill level 10 costs a single secret note and
no orb materials, which is exactly what [0007](0007-opart-verification.md) assumed when
carrying level 9 totals forward.

## Decision

**The workbook is not edited.** It remains the origin, and
`data/game/skill_costs_override.json` covers only confirmed students. Source, date, and
reason live in that file, applied changes are printed on every extraction, and reverting is
deleting an entry.

- 21 students corrected · 5 added (absent from the workbook) · 1 confirmed by hand

Result: cross-check **97.66% → 100.00% (2,660/2,660)**, no students missing cost data.

## The override file accumulates; it is not derived

Regenerating it from the report each time creates a **self-erasing loop**: the override
fills a gap, so the next report sees no gap, so regenerating drops that student and the gap
returns. Five students disappeared exactly this way once. Confirmed entries now merge with
the existing file and persist until a person removes them.

## Parser traps

Pairing quantities with icons by a single regex is wrong. Note icons are
`Item_Icon_SkillBook_*`, which does not match the material pattern, so a note's quantity
attaches to the following material instead and doubles it. Walk quantities and icons in
document order and pair each with the *next* one.

Normal, passive, and sub skills share one material table, but the wiki renders three. Adding
all three gives exactly triple.
