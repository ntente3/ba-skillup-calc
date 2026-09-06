/**
 * Full-roster comparison against the source spreadsheet.
 *
 * The workbook caches its own computed results; those are the answer key. Every student is
 * compared against them. A port done by reading formulas always leaks something past visual
 * review, and that kind of error surfaces months later, on the user's side.
 */
import { readFileSync } from "node:fs";
import { buildIndex, computeStudent, creditCost, gearCost } from "../src/core/calc.js";
import { SLOTS } from "../src/state/schema.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const loadOrNull = (p) => { try { return load(p); } catch { return null; } };
const game = {
  students:   load("../data/game/students.json"),
  skillCosts: load("../data/game/skill_costs.json"),
  cumulative: load("../data/game/cumulative.json"),
  gear:       load("../data/game/gear.json"),
  materials:  load("../data/game/materials.json"),
  collab:     load("../data/game/collab.json"),
};
const idx = buildIndex(game);
const expected = loadOrNull("../data/expected.json");
const expectedOpart = loadOrNull("../data/expected_opart.json");
const state = loadOrNull("../data/state_sample.json");

if (!expected || !expectedOpart || !state) {
  console.log("Skipped — this check uses real account data, which is not committed.");
  console.log("Run first:");
  console.log("  python3 scripts/extract_state.py <workbook.xlsx> data/state_sample.json");
  console.log("  python3 scripts/extract_expected.py <workbook.xlsx>");
  console.log("  python3 scripts/extract_expected_opart.py <workbook.xlsx>");
  process.exit(0);
}

const toObj = (arr) => Object.fromEntries(SLOTS.map((s, i) => [s.key, arr[i] ?? 0]));
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const fails = { bd: [], note: [], credit: [], gearCredit: [], opart: [] };
let compared = 0, skipped = 0;
const nonTrivial = { bdNote: 0, credit: 0, gearCredit: 0 };
let blanks = 0;

for (const exp of expected) {
  const arr = state.students[String(exp.sid)];
  if (!arr) { skipped++; continue; }
  const s = toObj(arr);
  if (!s.own) { skipped++; continue; }
  const got = computeStudent(idx, exp.sid, s);
  compared++;
  if (!eqArr(got.bd, exp.bd))     fails.bd.push({ k: "bd",   name: exp.name, sid: exp.sid, want: exp.bd,   got: got.bd });
  if (!eqArr(got.note, exp.note)) fails.note.push({ k: "note", name: exp.name, sid: exp.sid, want: exp.note, got: got.note });

  const c = creditCost(idx, s);
  if (exp.credit !== null && c.total !== exp.credit)
    fails.credit.push({ k: "credit", name: exp.name, sid: exp.sid, want: exp.credit, got: c.total });

  const gc = [0, 1, 2].reduce((a, i) => a + gearCost(idx, s[`curGear${i + 1}`],
    s[`tgtGear${i + 1}`] > 0 ? s[`tgtGear${i + 1}`] : s[`curGear${i + 1}`]).credit, 0);
  if (exp.gearCredit !== null && gc !== exp.gearCredit)
    fails.gearCredit.push({ k: "gearCredit", name: exp.name, sid: exp.sid, want: exp.gearCredit, got: gc });

  if (exp.bd.some(Boolean) || exp.note.some(Boolean)) nonTrivial.bdNote++;
  if (exp.credit) nonTrivial.credit++;
  if (exp.credit === null) blanks++;
  if (exp.gearCredit) nonTrivial.gearCredit++;
}

console.log(`compared ${compared} students (skipped ${skipped})`);
console.log(`rows excluded because the sheet has no formula there: ${blanks}`);
console.log(`non-zero sample — blu-ray/note ${nonTrivial.bdNote}, credits ${nonTrivial.credit}, gear credits ${nonTrivial.gearCredit}`);
for (const [k, list] of Object.entries(fails)) {
  if (!list.length) { console.log(`  ${k.padEnd(11)} match`); continue; }
  console.log(`  ${k.padEnd(11)} ${list.length} mismatched`);
  for (const f of list.slice(0, 4)) {
    console.log(`     ${f.name} (sid ${f.sid})${f.where ? " " + f.where : ""}  want ${JSON.stringify(f.want)}  got ${JSON.stringify(f.got)}`);
  }
}
/* ---- orbs: 20 materials x 4 grades ---- */
let opartCompared = 0, opartCells = 0;
for (const exp of expectedOpart) {
  const arr = state.students[String(exp.sid)];
  if (!arr) continue;
  const s = toObj(arr);
  if (!s.own) continue;
  const got = computeStudent(idx, exp.sid, s).opart;
  opartCompared++;
  for (let mi = 0; mi < exp.opart.length; mi++) {
    for (let g = 0; g < exp.opart[mi].length; g++) {
      if (exp.opart[mi][g]) opartCells++;
      if ((got[mi]?.[g] ?? 0) !== exp.opart[mi][g]) {
        fails.opart.push({
          name: exp.name, sid: exp.sid,
          want: exp.opart[mi][g], got: got[mi]?.[g] ?? 0,
          where: `${game.materials.opart[mi]} G${g}`,
        });
      }
    }
  }
}
console.log(`orb comparison: ${opartCompared} students, ${opartCells} non-zero cells`);

const total = Object.values(fails).reduce((a, l) => a + l.length, 0);
process.exit(total ? 1 : 0);

/* ------------------------------------------------------------------ *
 * An honest note on coverage
 *
 * This confirms the calculation *logic* agrees with the spreadsheet, but the sample is
 * whatever this account's state happens to exercise. Mostly maxed out, it leaves few
 * outstanding requirements — 144 non-zero orb cells. The 12,560-entry table is not
 * verified by this alone.
 *
 * Wider coverage would mean recalculating the workbook with different inputs, and it uses
 * LET/FILTER/CHOOSECOLS/TAKE, which LibreOffice does not reliably reproduce. Until then,
 * the invariant checks at extraction time (cumulative monotonicity, entry count) plus the
 * independent cross-check carry that weight.
 * ------------------------------------------------------------------ */
