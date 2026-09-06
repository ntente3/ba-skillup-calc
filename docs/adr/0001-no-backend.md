# ADR 0001 — No backend, no database

Status: accepted

## Context

Measurements of the source spreadsheet:

- Skill cost sheet: 356,905 cells, of which **12,560 hold a value (3.4%)**. 325,261 are
  empty cells carrying only formatting. That sheet alone is 8.30 MB of XML.
- Flattened to long form: 12,560 rows, 617 KB raw, **44 KB gzipped**.
- ~14,700 formulas total, but only **29 distinct shapes** — the rest is row-wise repetition.
- The collab sheet was already normalized long-form, so the direction was already set.

## Decision

No application server and no database. Static game data plus client-side calculation.

## Why

There is no server-side state to hold.

- Inputs (owned materials, target levels) are entirely local to one user
- Calculation is a pure function — same input, same output, no side effects
- Game data is a read-only table that changes only on patch

Two kinds of data with different needs:

| | Game data | User state |
|---|---|---|
| Size | 44 KB gz | ~4 KB gz |
| Access | read-only | read-write |
| Changes | on patch, by the maintainer | constantly, by the user |
| Needs | a CDN file | an identity |

A naive three-tier design calls an API on every recalculation, and *that* is where
traffic and hosting cost appear. With calculation in the browser, the server exchanges a
few KB per session at most.

## Consequences

- Static hosting suffices. GitHub Pages allows 100 GB/month soft; first load is ~220 KB
  gzipped and repeat visits are ~0.
- The spreadsheet is kept as a build artifact rather than discarded — 29 formula shapes
  make generation practical, and the existing audience already uses it.
- Cross-device sync is not free. Adding it later means a storage adapter, which is why
  the calculation core stays free of I/O.
