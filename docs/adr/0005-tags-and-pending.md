# ADR 0005 — Attribute tags, and deferred consumption

Status: accepted

## 1. Where attribute tags come from

The workbook holds only school and star. In-game filters (attack, defense, weapon,
position, role) need attributes that [0004](0004-external-data-sources.md) found nowhere
usable.

`schaledb.com` archived its repository but its **data endpoint is still live**, and it
uses the same Korean naming convention as the workbook — variant spellings included — so
**270 of 270 match on name alone** (only `시로코 테러` ↔ `시로코*테러` differs, by one
character).

Only **attribute tags** are taken. Cost data stays with the workbook; there is no reason
to replace 12,560 entries verified against the spreadsheet.

The official numeric `Id` is stored alongside as `officialId`. It does not replace `sid`,
which is the storage contract ([0002](0002-state-identity.md)).

## 2. Consumption is staged, not immediate

Raising a current level means the student was actually upgraded in game, so materials were
spent. That amount equals the requirement computed with the old value as "current" and the
new value as "target" — so the already-verified `computeStudent` is reused rather than a
second implementation.

**It is staged, not subtracted immediately.** Inventory is hand-entered; if a typo during
editing silently reduces it, there is no way to tell where things went wrong. Editing
several students and committing once also matches how the tool is actually used. A banner
shows what will be deducted, "Apply" performs it, and "Undo" reverses the whole batch.

**Lowering a level does not refund.** There is no way to distinguish a typo correction from
an actual rollback, and automatically increasing inventory invents materials that were
never held.

**Shortfalls go negative rather than clamping at zero.** Clamping discards how far short
you were. A negative means "there was unrecorded income of this much", and it reconciles
naturally once real counts are entered. A warning is shown on apply.

Import and migration are not upgrades, so the baseline is cleared and nothing is staged.

## A trap worth recording

Clicking a button blurs the input, firing `change` first. Re-rendering the banner at that
moment removes the button from the DOM mid-click, and the click never lands. Re-render only
when the content actually differs, and delegate the handler to the container rather than
the button.
