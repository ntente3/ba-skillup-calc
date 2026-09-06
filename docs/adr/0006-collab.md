# ADR 0006 — Collab costs fold into the existing totals

Status: accepted

## What it turned out to be

Collab students do not use new materials. Every `ITEM_CODE` resolves to something already
tracked:

| ITEM_CODE | Resolves to |
|---|---|
| `BD_<SCHOOL>_T<0-3>` | `bd.<school>.<grade>` |
| `NOTE_<SCHOOL>_T<0-3>` | `note.<school>.<grade>` |
| `SECRET_NOTE` | note grade 4; not tracked per school |
| `CREDIT` | credits |

The difference is the **combination**. A regular student draws Blu-rays and notes from
their own school; a collab student takes a little from several. One EX 1→2 step for a
single collab student wants 10 Blu-rays each from four different schools.

## Decision

No separate section. Fold into the existing Blu-ray, note, and credit totals — the
materials are the same, so the inventory is the same, and splitting them would divide
"total Blu-rays needed" across two places.

`computeStudent` therefore returns `bdBySchool` / `noteBySchool`. The previous assumption —
that a student's requirements belong to that student's school — does not hold for collab.

## Two traps

**Steps, not cumulative.** The skill cost sheet is cumulative, so a range is a subtraction.
The collab sheet is per-level `(1,2) (2,3) …`, so a range must be **summed**. Treating one
like the other is wrong by a wide margin.

**`노멀` vs `노말`.** The collab sheet and the calculation sheet spell the same skill
differently by one character. The match fails silently and a failed match just yields zero.

## Verification

With every collab student at current == target, the spreadsheet's own collab totals are all
zero — there is no answer key to compare against. Properties of range summation are checked
instead:

- levels form an unbroken chain (a gap leaks cost)
- **additivity**: `cost(1→10) === cost(1→5) + cost(5→10)`, at every split point. This is
  what catches an off-by-one in the `fromLv >= from && toLv <= to` predicate
- empty ranges are zero
- the full range equals the sum of the raw rows
- a collab student's Blu-rays really do span several schools

## Ahead

The mapping table contains `BD_ETC_T*` codes that no current event uses, so they are not in
`COLLAB_SCHOOL`. If a future event uses them the extractor **stops** — better than dropping
them silently.
