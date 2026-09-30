/**
 * New-student reserve (ADR 0009).
 *
 * The reserve is a promise: whatever lands in the next release window can be raised to
 * 5/9/9/9 out of stock. So the checks are that promise, not the arithmetic — each one
 * recomputes the bill from the shipped data and asserts the reserve covers it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndex, reserveIndex, opartCost, bdCost, noteCost, RESERVE_BATCH } from "../src/core/calc.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const game = {
  students:   load("../data/game/students.json"),
  skillCosts: load("../data/game/skill_costs.json"),
  cumulative: load("../data/game/cumulative.json"),
  gear:       load("../data/game/gear.json"),
  materials:  load("../data/game/materials.json"),
  collab:     load("../data/game/collab.json"),
};
const idx = buildIndex(game);
const R = reserveIndex(idx);

/** One brand-new student: EX 1->5, the other three skills 1->9. */
const NEW = { EX: { from: 1, to: 5 }, 노말: { from: 1, to: 9 }, 패시브: { from: 1, to: 9 }, 서브: { from: 1, to: 9 } };

test("school currencies reserve a full batch of new students", () => {
  const oneBd = bdCost(idx, 1, 5);
  const oneNote = noteCost(idx, 1, 9).map((v) => v * 3);   // normal, passive, sub
  assert.deepEqual(R.bd, oneBd.map((v) => v * RESERVE_BATCH));
  assert.deepEqual(R.note, oneNote.map((v) => v * RESERVE_BATCH));
  assert.equal(R.batch, RESERVE_BATCH);
});

test("every artifact type and grade covers a batch's worth of new students", () => {
  // The promise of a per-type reserve: whichever type the new students draw, the stock is
  // there. A type left at zero, or short of perType x the heaviest student on record,
  // breaks it.
  const under = [];
  for (const sid of idx.students.keys()) {
    const bill = opartCost(idx, sid, NEW).req;
    bill.forEach((row, mi) => row.forEach((q, g) => {
      const want = q * R.perType;
      if (want > R.opart[mi][g]) {
        under.push(`sid ${sid} ${game.materials.opart[mi]} ${g + 1}: ${want} > ${R.opart[mi][g]}`);
      }
    }));
  }
  assert.deepEqual(under, []);
  R.opart.forEach((row, mi) => row.forEach((v, g) => {
    assert.ok(v > 0, `${game.materials.opart[mi]} grade ${g + 1} has no reserve`);
  }));
});

test("a student still splits across two artifact types", () => {
  // perType is the batch divided by this split. If a patch ever gives a student three
  // types, the divisor in calc.js is wrong and the reserve quietly sags — so it fails here
  // rather than in someone's inventory.
  const worst = [...idx.students.keys()]
    .map((sid) => opartCost(idx, sid, NEW).req.filter((row) => row.some(Boolean)).length)
    .reduce((a, b) => Math.max(a, b), 0);
  assert.equal(worst, 2);
  assert.equal(R.perType, Math.ceil(RESERVE_BATCH / 2));
});

test("the batch size drives the artifact reserve", () => {
  // Not a hardcoded multiplier: a bigger batch has to move the numbers.
  const wide = reserveIndex(idx, RESERVE_BATCH * 2);
  assert.equal(wide.perType, R.perType * 2);
  R.opart.forEach((row, mi) => row.forEach((v, g) => assert.equal(wide.opart[mi][g], v * 2)));
});
