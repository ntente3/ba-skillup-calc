/**
 * Collab range summation.
 *
 * With every collab student at current == target, the spreadsheet's own collab totals are
 * all zero, so there is no answer key. Properties of range summation are checked instead —
 * additivity in particular catches an off-by-one in the
 * `fromLv >= from && toLv <= to` predicate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndex, collabCost, computeStudent, SKILL_KEYS } from "../src/core/calc.js";
import { SLOTS, SLOT_INDEX } from "../src/state/schema.js";

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
const raw = game.collab;
const sids = [...new Set(raw.map((r) => r.sid))];

const levels = (o) => Object.fromEntries(SKILL_KEYS.map((k) => [k, o[k] || { from: 0, to: 0 }]));
const flat = (c) => {
  const out = { credit: c.credit };
  for (const kind of ["bd", "note"]) {
    for (const [sc, arr] of Object.entries(c[kind])) arr.forEach((v, g) => { if (v) out[`${kind}.${sc}.${g}`] = v; });
  }
  return out;
};
const add = (a, b) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v;
  for (const k of Object.keys(o)) if (!o[k]) delete o[k];
  return o;
};

test("collab students are present in the index", () => {
  assert.equal(sids.length, 4);
  for (const sid of sids) assert.ok(idx.collab.has(sid), `sid ${sid}`);
});

test("every ITEM_CODE resolves to a known material", () => {
  const bad = raw.filter((r) => r.kind == null);
  assert.deepEqual(bad, [], "an unresolved code drops that material from the totals entirely");
});

test("level steps form an unbroken chain", () => {
  const by = new Map();
  for (const r of raw) {
    const k = `${r.sid}|${r.skill}`;
    (by.get(k) || by.set(k, new Set()).get(k)).add(r.fromLv);
  }
  for (const [k, set] of by) {
    const lv = [...set].sort((a, b) => a - b);
    for (let i = 1; i < lv.length; i++) {
      assert.equal(lv[i], lv[i - 1] + 1, `${k} has a gap: ${lv[i - 1]} -> ${lv[i]}`);
    }
  }
});

test("ranges are additive — cost(1->10) === cost(1->5) + cost(5->10)", () => {
  for (const sid of sids) {
    for (const key of SKILL_KEYS) {
      const steps = idx.collab.get(sid)?.get(key);
      if (!steps) continue;
      const max = Math.max(...steps.map((r) => r.toLv));
      const min = Math.min(...steps.map((r) => r.fromLv));
      for (let mid = min + 1; mid < max; mid++) {
        const whole = flat(collabCost(idx, sid, levels({ [key]: { from: min, to: max } })));
        const a = flat(collabCost(idx, sid, levels({ [key]: { from: min, to: mid } })));
        const b = flat(collabCost(idx, sid, levels({ [key]: { from: mid, to: max } })));
        assert.deepEqual(whole, add(a, b), `sid ${sid} ${key} split at ${mid}`);
      }
    }
  }
});

test("an empty range costs nothing", () => {
  for (const sid of sids) {
    for (const key of SKILL_KEYS) {
      const c = collabCost(idx, sid, levels({ [key]: { from: 5, to: 5 } }));
      assert.deepEqual(flat(c), { credit: 0 }, `sid ${sid} ${key}`);
    }
  }
});

test("the full range equals the sum of the raw rows", () => {
  for (const sid of sids) {
    const steps = [...(idx.collab.get(sid) || new Map()).values()].flat();
    const expect = {};
    for (const r of steps) {
      const k = r.kind === "credit" ? "credit" : `${r.kind}.${r.school ?? ""}.${r.grade}`;
      expect[k] = (expect[k] || 0) + r.qty;
    }
    const got = flat(collabCost(idx, sid, levels(Object.fromEntries(
      SKILL_KEYS.map((k) => [k, { from: 0, to: 99 }])))));
    assert.deepEqual(got, expect, `sid ${sid}`);
  }
});

test("a collab student's Blu-rays span several schools", () => {
  const sid = sids[0];
  const s = Object.fromEntries(SLOTS.map((x) => [x.key, 0]));
  s.own = 1; s.curEx = 1; s.tgtEx = 5;
  s.curNormal = 1; s.tgtNormal = 10;
  const r = computeStudent(idx, sid, s);
  assert.ok(r.isCollab, "should be recognised as collab");
  const schools = Object.keys(r.bdBySchool);
  assert.ok(schools.length > 1, `Blu-rays landed on a single school: ${schools}`);
  assert.ok(r.credit > 0, "credits should be counted");
});
