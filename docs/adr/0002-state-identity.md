# ADR 0002 — Students are keyed by a stable id, never by name

Status: accepted

## Context

The spreadsheet looks students up by their Korean name:

```
=IFERROR(MATCH($B13, 자료2!$A$3:$A$10074, 0), "")
```

The roster already contains costume variants written as `Name (Swimsuit)`,
`Name (Guide)`, and so on. If a spelling changes — a translation revision, a typo fix —
the lookup becomes `#N/A` and everything the user entered for that student silently
disappears. Per [0001](0001-no-backend.md) there is no server to migrate anything.

## Decision

Identify students by an integer `sid`.

> **A `sid`, once assigned, never changes. New students get `max + 1`.**

The registry (`data/student_ids.json`) is committed. It *is* the contract, so it is
managed as data, not code: never sorted, never regenerated, never compacted to fill gaps.
Name changes are absorbed through `aliases`.

## Alternatives rejected

- **Names directly.** Silent data loss on any spelling change.
- **Sheet row order.** Inserting a student in the middle shifts everyone after them by
  one. The user then sees *someone else's data* with no error at all — the worst
  possible failure.
- **Official game ids.** The most stable option. These are now recorded alongside as
  `officialId`, but they do not replace `sid`: `sid` is the storage format's contract.

## Consequences

- `scripts/student_ids.py verify()` checks for duplicates, reuse, and alias cycles.
- Unknown sids on import are kept, not dropped — data may catch up in a later update.
- Import always reports what happened: "268 of 270 restored, 2 held".
