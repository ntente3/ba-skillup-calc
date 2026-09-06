# Blue Archive Skill-Up Material Calculator

A no-build, client-side calculator for Blue Archive skill and gear upgrade materials.
Rebuilt from a spreadsheet into separated data, a pure calculation core, and a static UI.

**Not affiliated with NEXON Games or Yostar.** Game data and icons are the property of
their respective owners.

---

## What this is

Plan how much material you need to take students from their current levels to your
targets, and see what you are short of against your current inventory.

- **269+ students**, 20 orb material types x 4 grades, per-school Blu-rays and notes,
  gear tiers, credits, and collab events
- **Multi-axis filtering** — school, attack type, defense type, weapon, position,
  squad, role, rarity, current star
- **Bulk targets** — 3/5/5/5, 4/7/7/7, 5/9/9/9 applied to whatever the filter shows
- **Pending consumption** — raise a current level and the app stages the materials it
  would cost, then subtracts them from inventory only when you commit
- **Export / import** — your data lives in your browser; a JSON file moves it between devices

## Architecture

```
data/game/     Game data. Read-only, changes only on patch.
src/core/      Calculation. Pure functions, no DOM, no I/O.
src/state/     User state schema and serialization.
web/           UI. Vanilla ES modules, no framework.
scripts/       Extraction and verification pipeline (Python + Node).
tests/         21 tests plus a full-roster comparison against the source spreadsheet.
```

There is no backend. Game data is static files; the calculation runs entirely in the
browser; user state stays in `localStorage` and moves by file. See
[`docs/adr/0001-no-backend.md`](docs/adr/0001-no-backend.md) for why.

### Why the data is shaped this way

The source spreadsheet stored skill costs as a 4,545 x 88 wide matrix in which only
**3.4% of cells held a value** — the rest were empty cells carrying formatting. Flattened
to long form, the same information is 12,560 rows.

```
Source sheet XML        8.30 MB
All game data (gzip)    33.8 KB
```

Every table is **cumulative**: the value at level N is the total to reach N, so the cost
of a range is a subtraction, not a loop. Collab events are the exception — those are
per-level steps and get summed. Mixing the two up silently produces wrong numbers, so
both are covered by property tests.

## Verification

The calculation was ported from spreadsheet formulas, so it is checked two ways.

**Against the source spreadsheet.** The workbook caches its own computed results; those
are the answer key. All students compared on Blu-rays, notes, credits, gear credits, and
orb materials — all matching.

**Against independent sources.** Spreadsheet coverage is bounded by one account's state,
which left most of the 12,560-entry table untested. Cross-checking every entry against
[SchaleDB](https://schaledb.com) reached **100% (2,660/2,660)** after corrections.

That cross-check found real defects:

- **7 cumulative carry-forward omissions.** A value present at level N vanished at N+1.
  Because range cost is a subtraction, the result went negative and clamped to zero —
  the calculator silently *under-reported* what you needed.
- **61 disputed values across 22 students.** Resolved with a third source
  ([bluearchive.wiki](https://bluearchive.wiki), CC BY-SA 4.0): **130 comparisons, all
  siding against the spreadsheet, zero counterexamples.** Several were "same quantity,
  adjacent material" — the signature of a value pasted one column block over.

Corrections live in `data/game/skill_costs_override.json` with source, date, and reason.
The spreadsheet stays the origin; the override only covers what was independently confirmed.

## Running it

Requires Node 18+.

```
npm run dev     # http://localhost:8080
npm test        # 21 tests
npm run parity  # full-roster comparison against the spreadsheet
```

Opening `index.html` directly will not work — ES module imports and `fetch` are blocked
over `file://`. See [`docs/LOCAL.md`](docs/LOCAL.md).

## Regenerating data

Needs Python 3 with `openpyxl`, plus the source workbook.

```
python scripts/extract_game.py  <workbook.xlsx>   # game data + overrides
python scripts/fetch_tags.py                      # student attributes
python scripts/extract_icons.py <workbook.xlsx>   # material icons
```

To re-verify after a patch:

```
python scripts/crosscheck_opart.py    # spreadsheet vs SchaleDB
python scripts/crosscheck_wiki.py     # disputes vs bluearchive.wiki
python scripts/fetch_overrides.py     # accumulate confirmed corrections
python scripts/extract_game.py  <workbook.xlsx>
```

The override file **accumulates**; it is never regenerated from scratch. Rebuilding it
from the report creates a self-erasing loop: the override fills a gap, the next report
sees no gap, and regenerating drops the entry.

## Design decisions

| | |
|---|---|
| [0001](docs/adr/0001-no-backend.md) | No backend or database |
| [0002](docs/adr/0002-state-identity.md) | Students keyed by stable id, never by name |
| [0003](docs/adr/0003-shortfall-display.md) | Symbols over signs for shortfall |
| [0004](docs/adr/0004-external-data-sources.md) | Which external sources are usable |
| [0005](docs/adr/0005-tags-and-pending.md) | Attribute tags; deferred consumption |
| [0006](docs/adr/0006-collab.md) | Collab folded into existing totals |
| [0007](docs/adr/0007-opart-verification.md) | Orb verification and cumulative repair |
| [0008](docs/adr/0008-three-way-crosscheck.md) | Three-way cross-check |

## License

Code is MIT (see `LICENSE`). Game data and icons are not covered by it and remain the
property of their respective owners.
