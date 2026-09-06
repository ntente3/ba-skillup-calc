# ADR 0007 — Orb material verification and cumulative repair

Status: accepted

## Problem

Comparison against the spreadsheet checks that the logic agrees, but the sample is bounded
by one account's state. Mostly maxed out, it left only **144 non-zero orb cells** — about
1% of a 12,560-entry table.

## Three approaches

### 1. Full cross-check against an independent source

`schaledb.com` is generated from game data, and its item id scheme maps exactly onto the
material array:

```
item id = 100 + materialIndex * 10 + grade
```

100–103 Nebra Disc, 110–113 Phaistos Disc, and so on — the same order as the sheet columns.
SchaleDB is per-level, so it is accumulated before comparing; Blu-rays (3xxx) and notes
(4xxx) are out of scope for this table, so only 100–399 is kept.

Result: **2,549 / 2,610 rows matching (97.66%)**, 61 disputes across 22 students, 5 students
missing from the workbook entirely.

### 2. Invariants that do not depend on the sample

- Cumulative means no material may decrease as level rises (8,000+ adjacent pairs)
- Ranges are additive: `cost(a→c) === cost(a→b) + cost(b→c)`, at every split (1,000+)
- Empty and reversed ranges are zero

### 3. Cumulative repair

The invariants found **7 omissions in the workbook** — a cumulative value that failed to
carry into the next level. In one case a student's level 10 row carried one material
forward but dropped another entirely.

**The symptom is silent.** Range cost is a subtraction, so `target − current` goes negative,
and negative clamps to zero and reads as "nothing needed". The calculator was
*under-reporting* requirements with no error anywhere.

A cumulative table cannot decrease — that is a property of the structure — so carrying the
previous level's value forward is the only consistent repair, and it requires trusting no
external source. Repairs are printed on every extraction, never applied silently.

After repair the cross-check rose 2,548 → **2,549**: one case came into agreement with
SchaleDB, an independent confirmation that the repair was right.

## Why the first test missed it

The initial monotonicity check compared only levels where a value was *present*. A cell that
vanished entirely never entered the comparison. Treating a missing value as zero found it.

The additivity test caught it first, which is why both are kept.
