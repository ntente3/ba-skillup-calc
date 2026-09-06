# Running locally

## Requirements

**Node 18+ is enough to run the app.** Everything else is only for regenerating data.

| Tool | Needed for |
|---|---|
| Node 18+ | running the app, tests |
| Python 3 + openpyxl | re-extracting data from the workbook |

```
node --version
```

## 1. Start it

```
npm run dev
```

Open http://localhost:8080. To use another port:

```
npm run dev -- 8081
```

> **Do not open `index.html` directly.** This app uses ES modules with no bundler, and
> over `file://` the browser blocks module imports and `fetch` as cross-origin. A blank
> page or "failed to load data" almost always means this.

`npm run dev` runs `scripts/serve.mjs` — Node standard library only, no dependencies.
Python was avoided because the command differs across platforms (`python`, `py`,
`python3`).

## 2. Load your data

The app starts empty and keeps state in browser `localStorage`.

If you have exported state, use **Import** (top right) and pick the JSON file.

To extract state from a workbook:

```
python scripts/extract_state.py <workbook.xlsx> data/state_sample.json
```

That output is real account data and is gitignored.

## 3. What to try

**Students tab**

- **Filter** — school, attack, defense, weapon, position, squad, role, rarity, current
  star. OR within a group, AND across groups.
- **Columns** — collapse the current / target / gear blocks.
- **Bulk target** — 3/5/5/5, 4/7/7/7, 5/9/9/9, 5/10/10/10, applied to **whatever the
  filter currently shows**. The filter is the selection. Individual edits still work
  afterwards.
- **Gear target** — T5/T7/T9/T10, same idea.

**Raise a current level** and a banner appears:

```
1 upgraded · pending consumption   4 material types · credits … will be deducted.
[Apply to inventory]  [Dismiss]
```

Applying deducts, and **Undo** appears immediately after. Nothing is deducted while you
type — a typo during editing would otherwise reduce inventory with no trace. Lowering a
level does **not** refund; a typo correction and a real rollback are indistinguishable.

**Totals panel**

- Defaults to **short only** (192 rows becomes 48). **All** shows everything.
- **Required/owned** toggle adds two more numbers.
- The number always means **shortfall**; `✓` when satisfied.
- The 2px bar under each row is progress. Hover for `required · owned · short`.

**Inventory tab** — type counts directly; the totals panel updates as you go.

## 4. Verification

```
npm test          21 tests
npm run parity    full-roster comparison against the workbook
npm run check     both
```

`npm run parity` uses real account data. Without it, it skips with instructions rather
than failing.

## 5. Regenerating data

Order matters — each step consumes the previous one's output.

```
python scripts/extract_game.py  <workbook.xlsx>
python scripts/fetch_tags.py
python scripts/extract_icons.py <workbook.xlsx>
```

To re-verify values after a game patch:

```
python scripts/crosscheck_opart.py
python scripts/crosscheck_wiki.py
python scripts/fetch_overrides.py
python scripts/extract_game.py  <workbook.xlsx>
```

`fetch_tags`, `crosscheck_*`, and `fetch_overrides` need network access.

> `skill_costs_override.json` **accumulates**. Regenerating it from the report each time
> creates a self-erasing loop — the override fills a gap, the next report sees no gap,
> and regenerating drops the entry.

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| Blank page / "failed to load data" | Opened over `file://`. Use `npm run dev` |
| `EADDRINUSE` | Port in use. `npm run dev -- 8081` |
| Fallback fonts | Google Fonts blocked. Cosmetic only — fonts load asynchronously by design |
| No icons | `extract_icons.py` has not been run |
| Only school and rarity filters | `data/game/tags.json` missing. Run `fetch_tags.py` |
| Entries gone after reopening | `localStorage` — private window, or site data cleared. Use **Export** to back up |
