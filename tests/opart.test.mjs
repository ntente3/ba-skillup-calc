/**
 * Orb material requirements.
 *
 * The spreadsheet comparison is bounded by one account's state, which left only 144
 * non-zero cells — about 1% of a 12,560-entry table. These checks do not depend on that
 * sample:
 *
 *  1) invariants of the table itself — what must hold if it is cumulative
 *  2) properties of range arithmetic — additivity catches off-by-one at the boundary
 *
 * The exhaustive cross-check against an independent source lives in
 * scripts/crosscheck_opart.py (needs network); its summary is data/crosscheck_opart.json.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndex, opartCost, SKILL_KEYS } from "../src/core/calc.js";

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
const rows = game.skillCosts;

const levels = (skill, from, to) =>
  Object.fromEntries(SKILL_KEYS.map((k) => [k, k === skill ? { from, to } : { from: 0, to: 0 }]));
const flat = (grid) => {
  const o = {};
  grid.forEach((row, mi) => row.forEach((v, g) => { if (v) o[`${mi}.${g}`] = v; }));
  return o;
};
const add = (a, b) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v;
  return o;
};

test("material and grade indices are in range", () => {
  const nMat = game.materials.opart.length;
  for (const r of rows) {
    for (const [mi, g, q] of r.req) {
      assert.ok(mi >= 0 && mi < nMat, `material index ${mi} (${r.sid}/${r.skill}/${r.lv})`);
      assert.ok(g >= 0 && g < 4, `grade ${g}`);
      assert.ok(Number.isInteger(q) && q > 0, `quantity ${q}`);
    }
  }
});

test("cumulative values never decrease as level rises", () => {
  // Comparing only levels where a value is *present* misses a cell that vanished
  // entirely. Seven did exactly that, and because range cost is a subtraction the result
  // went negative, clamped to zero, and under-reported. Missing is treated as zero here.
  const byPair = new Map();
  const levelsOf = new Map();
  for (const r of rows) {
    const sk = `${r.sid}|${r.skill}`;
    (levelsOf.get(sk) || levelsOf.set(sk, new Set()).get(sk)).add(r.lv);
    for (const [mi, g, q] of r.req) {
      const k = `${sk}|${mi}|${g}`;
      (byPair.get(k) || byPair.set(k, new Map()).get(k)).set(r.lv, q);
    }
  }
  let checked = 0;
  const bad = [];
  for (const [k, m] of byPair) {
    const sk = k.split("|").slice(0, 2).join("|");
    const lv = [...levelsOf.get(sk)].sort((a, b) => a - b);
    for (let i = 1; i < lv.length; i++) {
      const prev = m.get(lv[i - 1]) ?? 0;
      const cur = m.get(lv[i]) ?? 0;
      if (prev === 0 && cur === 0) continue;
      checked++;
      if (cur < prev) bad.push(`${k}: Lv${lv[i - 1]}=${prev} -> Lv${lv[i]}=${cur}`);
    }
  }
  assert.deepEqual(bad, [], "a decrease makes range cost negative, which clamps to zero silently");
  assert.ok(checked > 8000, `too few adjacent pairs checked: ${checked}`);
});

test("ranges are additive — cost(a->c) === cost(a->b) + cost(b->c)", () => {
  const bySid = new Map();
  for (const r of rows) {
    const k = `${r.sid}|${r.skill}`;
    (bySid.get(k) || bySid.set(k, []).get(k)).push(r.lv);
  }
  let cases = 0;
  for (const [k, lvs] of bySid) {
    const [sidStr, skill] = k.split("|");
    const sid = Number(sidStr);
    const our = skill === "EX" ? "EX" : "노말";
    const lo = Math.min(...lvs), hi = Math.max(...lvs);
    for (let mid = lo; mid < hi; mid++) {
      const whole = flat(opartCost(idx, sid, levels(our, lo - 1, hi)).req);
      const a = flat(opartCost(idx, sid, levels(our, lo - 1, mid)).req);
      const b = flat(opartCost(idx, sid, levels(our, mid, hi)).req);
      assert.deepEqual(whole, add(a, b), `sid ${sid} ${our} split at ${mid}`);
      cases++;
    }
  }
  assert.ok(cases > 1000, `too few splits checked: ${cases}`);
});

test("empty and reversed ranges cost nothing", () => {
  for (const r of rows.slice(0, 300)) {
    const our = r.skill === "EX" ? "EX" : "노말";
    assert.deepEqual(flat(opartCost(idx, r.sid, levels(our, r.lv, r.lv)).req), {});
    assert.deepEqual(flat(opartCost(idx, r.sid, levels(our, r.lv, r.lv - 1)).req), {});
  }
});

test("the cross-check report has not regressed", () => {
  let report;
  try {
    report = load("../data/crosscheck_opart.json");
  } catch {
    console.log("  (no report — run scripts/crosscheck_opart.py first)");
    return;
  }
  // Fewer agreeing rows means extraction or mapping regressed.
  assert.ok(report.agree >= 2660, `agreeing rows dropped: ${report.agree} < 2660`);
  assert.equal(report.conflicts.length, 0, "a row now disagrees with the independent source");
  assert.equal(report.missingInWorkbook.length, 0, "a student is missing cost data again");
});
