# ADR 0003 — Shortfall is shown with symbols, not signs

Status: accepted

## Context

The totals panel listed three numbers per material — required, owned, short — in a 340px
rail across 192 rows. Worse, the same cell showed the requirement when satisfied and the
shortfall when not, so a number's meaning changed with the situation.

Compressing to a signed number was considered, but the direction is genuinely undecided:

- The source spreadsheet computes `required − owned`, so **positive means short**
- Ordinary inventory convention is `owned − required`, so **negative means short**

Either choice leaves some users reading the sign backwards, and reading it backwards
produces no error — you simply farm for something you already had.

## Reference

The [Blue Archive Resource Planner](https://justin163.com/planner/) identifies materials
by icon, edits owned counts in place, and filters down to what is relevant. It does not
line up several numbers per row.

## Decision

1. **One meaning per position — the shortfall.** Blank when satisfied; the right-hand
   column carries only what is left to do.
2. **State as a symbol.** `▲` short (red), `✓` satisfied (green). No sign ambiguity.
3. **Required and owned move to form and tooltip.** A 2px fill bar under each row shows
   progress; hovering gives `required 355 · owned 332 · short 23`.
4. **"Short only" by default.** 192 rows becomes 48. Toggles expand to everything.

## A trap worth recording

Colouring the progress fill red when short made it read as *"more red is better"* — the
meaning inverted. The bar is progress, so the fill uses progress colours only (amber
partial, green complete) and red is reserved for the number.
