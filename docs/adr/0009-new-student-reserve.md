# ADR 0009 — Surplus is measured against a new-student reserve

Status: accepted

## Context

The rail showed shortfall and nothing else ([ADR 0003](0003-shortfall-display.md)). That
answers one question — can I finish the students I already own — and it is the wrong
question the moment a new student is announced, because the material has to be on hand
that day or the upgrade waits two weeks for the next farming cycle.

Surplus was therefore invisible: stock above the requirement showed as `✓` whether it was
three spare Blu-rays or three thousand. "How much extra should I be sitting on" had no
answer in the tool, and without a threshold a raw surplus number is not actionable either
— every satisfied row would just print a large number nobody can judge.

## Decision

A **reserve**: per material, the stock worth holding for students not yet released. Each
row then sits somewhere against two lines, the requirement and the requirement plus the
reserve, and the glyph says where.

### The batch size

Six students inside one two-week window is the largest release batch on record. That is the
worst case the reserve is sized for.

### Blu-rays and notes — batch × one student

Both are per-school currencies, and a whole batch can land in one school, so a school's
reserve is six students' worth. One student means EX 1→5 for Blu-rays and 1→9 on each of
normal, passive and sub for notes:

| | 기초 | 일반 | 상급 | 최상 |
|---|---|---|---|---|
| BD, per school | 180 | 180 | 180 | 48 |
| Note, per school | 450 | 450 | 450 | 360 |

Level 10 is excluded. It needs secret notes, which cannot be farmed ahead, so no reserve
would change the outcome.

### Artifacts — three students per type and grade

Artifacts are spent in two roles. A student's skills draw a **main** type and a
**secondary** one — 262 of the 266 students on record use exactly two — and the two roles
are sized differently:

| role | one student's bill, 1→5/9/9/9 | median | grade 4 |
|---|---|---|---|
| main | 164–446 | 283 | zero for 15 of 20 types |
| secondary | 119–217 | 152 | always present |

So the main role supplies grades 1–3 and the secondary role supplies grade 4. Taking the
largest bill on record *per grade* therefore lands on main consumption where it matters and
still covers a new student whichever role they put the type in.

Unlike a school, a type is not drawn sparsely — there is no "which school" lottery to wait
out, and every release spends both roles. So the school rule applies here too, divided by
the two types a student splits across: **`6 / 2` = 3 students' worth per type and grade.**
That is 22,272 artifacts across the 80 type-grade slots, 1,029–1,365 per type.

An earlier version sized this by how often a type comes up instead — expected users among
six releases, `6 × users / roster`, which runs 0.32–0.90 and so floored at a single
student. Rejected: that treats a type like a school it is not, and a reserve that thin is
one unlucky pair of releases away from being no reserve at all. The divisor is now the role
split, which the batch size drives directly.

The split itself is a constant in `calc.js`, not derived: deriving a divisor from the data
would let a patch *lower* the reserve on its own. A test asserts no student draws more than
two types, so a change has to be looked at rather than silently absorbed.

### Gear gets no reserve

Its tiers are shared by every student and farmed continuously. There is no release event to
be caught out by, so a tier shows up only when it is needed or held.

## Display

The number column keeps one meaning — *distance to a line* — and the glyph says which line
and which direction. Still no signed numbers, for the reason ADR 0003 gives.

| | | |
|---|---|---|
| `▲` red | short of the requirement | act now |
| `△` amber | requirement met, under the reserve | farm when idle |
| `✓` green | on the line | |
| `+` accent | spare above the reserve | free to spend |

Surplus is the only state that tints its row. Tinting the amber state as well would paint
most of the full listing, and a warning that covers everything warns about nothing.

The rail's mode switch gains **초과** between 부족만 and 전체, and the reserve thresholds
ride along as a legend wherever those glyphs can appear — the glyphs are unreadable
without them.

Rows now span the whole stock universe rather than only what is required today: a new
student can come from any school and draw any type, so every school and every type-grade
carries a reserve row even at zero requirement. The mode filter decides what is shown, so
the default view is unchanged.

## Consequence

The thresholds are data-derived, not written down: they recompute from the shipped tables
on load, so a patch that adds a material type or changes a skill cost moves them with it.
The cost is that the reserve is only as good as the roster in `data/game/` — a type that
exists in game but is not in the tables yet reserves nothing.
