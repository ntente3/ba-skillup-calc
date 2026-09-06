/**
 * Calculation core — pure functions only.
 *
 * The source spreadsheet has ~14,700 formulas but only 29 distinct shapes; most are the
 * same INDEX+MATCH lookup repeated down a column. Here the lookups become indices and only
 * the arithmetic remains.
 *
 * The property everything rests on: **the source tables are cumulative.** A (student,
 * skill, level) value is the total to *reach* that level, which is why the sheet consumes
 * it as `INDEX(vals, target) - INDEX(vals, current)`. Verified: 8,883 adjacent level pairs,
 * zero decreases. So a range cost is always a subtraction, never a loop over levels.
 */

/** The collab sheet and the calculation sheet spell this skill differently by one
 *  character. The mismatch is silent, and a failed match just yields zero. */
const COLLAB_SKILL = { "노멀": "노말" };

/** The cost table has only two skill kinds: EX and "normal". Normal, passive and sub all
 *  share the latter. */
export const SKILL_TABLE = { EX: "EX", 노말: "일반", 패시브: "일반", 서브: "일반" };
export const SKILL_KEYS = ["EX", "노말", "패시브", "서브"];

/** State slots per skill (mirrors the keys in schema.js SLOTS). */
const CUR_KEY = { EX: "curEx", 노말: "curNormal", 패시브: "curPass", 서브: "curSub" };
const TGT_KEY = { EX: "tgtEx", 노말: "tgtNormal", 패시브: "tgtPass", 서브: "tgtSub" };

/* ------------------------------------------------------------------ */
/* index construction                                                   */
/* ------------------------------------------------------------------ */

/**
 * Turn the long-form data into lookup indices. Built once and reused — lookups dominate
 * the cost of calculating.
 */
export function buildIndex(game) {
  const skill = new Map();               // `${sid}|${table}` -> Map(lv -> req[])
  for (const row of game.skillCosts) {
    const k = `${row.sid}|${row.skill}`;
    let m = skill.get(k);
    if (!m) skill.set(k, (m = new Map()));
    m.set(row.lv, row.req);
  }
  const students = new Map(game.students.map((s) => [s.sid, s]));
  const gearTypeIndex = new Map((game.gear.types || []).map((t, i) => [t, i]));

  // Collab: sid -> skill -> list of steps.
  // Unlike the cost table these are per-level steps, not cumulative, so ranges are summed.
  const collab = new Map();
  for (const row of game.collab || []) {
    if (row.kind == null) continue;
    let m = collab.get(row.sid);
    if (!m) collab.set(row.sid, (m = new Map()));
    const key = COLLAB_SKILL[row.skill] || row.skill;
    let list = m.get(key);
    if (!list) m.set(key, (list = []));
    list.push(row);
  }

  return { skill, students, gearTypeIndex, collab,
           cum: game.cumulative, gear: game.gear, materials: game.materials };
}

/* ------------------------------------------------------------------ */
/* cumulative table lookup                                              */
/* ------------------------------------------------------------------ */

/** Value at a level in a cumulative table; missing levels fall back to the nearest below. */
function cumAt(table, lv) {
  if (lv == null || lv <= 0) return null;
  if (table[lv] !== undefined) return table[lv];
  let best = null;
  for (const k of Object.keys(table)) {
    const n = Number(k);
    if (n <= lv && (best === null || n > best)) best = n;
  }
  return best === null ? null : table[best];
}

function diffVec(table, from, to, width) {
  const zero = new Array(width).fill(0);
  if (!(to > from)) return zero;
  const a = cumAt(table, to) || zero;
  const b = cumAt(table, from) || zero;
  return a.map((v, i) => Math.max(0, v - (b[i] || 0)));
}

function diffScalar(table, from, to) {
  if (!(to > from)) return 0;
  const a = cumAt(table, to) || 0;
  const b = cumAt(table, from) || 0;
  return Math.max(0, (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b));
}

/* ------------------------------------------------------------------ */
/* individual requirements                                              */
/* ------------------------------------------------------------------ */

/** Blu-rays, EX skill only — [basic, normal, advanced, superior]. */
export function bdCost(idx, exFrom, exTo) {
  return diffVec(idx.cum.bd, exFrom, exTo, 4);
}

/** Notes for normal/passive/sub — [basic, normal, advanced, superior, secret]. */
export function noteCost(idx, from, to) {
  return diffVec(idx.cum.note, from, to, 5);
}

/**
 * Orb materials — 20 kinds x 4 grades. Returns a `[materialIndex][grade]` grid.
 */
export function opartCost(idx, sid, skillLevels) {
  const out = Array.from({ length: idx.materials.opart.length }, () => [0, 0, 0, 0]);
  let missing = false;
  for (const key of SKILL_KEYS) {
    const { from, to } = skillLevels[key] || {};
    if (!(to > from)) continue;
    const m = idx.skill.get(`${sid}|${SKILL_TABLE[key]}`);
    if (!m) { missing = true; continue; }
    const add = (lv, sign) => {
      const req = m.get(lv);
      if (!req) return;
      for (const [mi, g, q] of req) out[mi][g] += sign * q;
    };
    add(to, +1);
    add(from, -1);
  }
  for (const row of out) for (let g = 0; g < row.length; g++) if (row[g] < 0) row[g] = 0;
  return { req: out, missing };
}

/**
 * Gear — how many of each tier 2..10 are needed. That table is cumulative too, so this is
 * the difference between target and current tier.
 */
export function gearCost(idx, fromTier, toTier) {
  const width = idx.gear.tierLabels.length;
  const zero = new Array(width).fill(0);
  if (!(toTier > fromTier)) return { req: zero, credit: 0 };
  const a = idx.gear.req[toTier] || zero;
  const b = idx.gear.req[fromTier] || zero;
  const ca = idx.gear.credit[toTier]?.cum || 0;
  const cb = idx.gear.credit[fromTier]?.cum || 0;
  return {
    req: a.map((v, i) => Math.max(0, v - (b[i] || 0))),
    credit: Math.max(0, ca - cb),
  };
}

/**
 * Skill cost for a collab student.
 *
 * Collab does not introduce new materials — it draws existing Blu-rays and notes from
 * several schools at once. So the result joins the ordinary totals rather than forming a
 * separate category.
 *
 * The cost table is cumulative (subtract); this one is per-step (sum).
 */
export function collabCost(idx, sid, skillLevels) {
  const bySkill = idx.collab.get(sid);
  const out = { bd: {}, note: {}, credit: 0 };
  if (!bySkill) return { ...out, has: false };

  for (const key of SKILL_KEYS) {
    const { from, to } = skillLevels[key] || {};
    if (!(to > from)) continue;
    const steps = bySkill.get(key);
    if (!steps) continue;
    for (const r of steps) {
      if (!(r.fromLv >= from && r.toLv <= to)) continue;
      if (r.kind === "credit") { out.credit += r.qty; continue; }
      const bucket = r.kind === "bd" ? out.bd : out.note;
      // Secret notes have no school (null) — that empty key is used as-is.
      const school = r.school ?? "";
      const arr = bucket[school] || (bucket[school] = [0, 0, 0, 0, 0]);
      arr[r.grade] += r.qty;
    }
  }
  return { ...out, has: true };
}

/** Credits — skills, stars, and levels combined. */
export function creditCost(idx, s) {
  const skill =
    diffScalar(idx.cum.creditEx, s.curEx, tgt(s, "curEx", "tgtEx")) +
    diffScalar(idx.cum.creditSkill, s.curNormal, tgt(s, "curNormal", "tgtNormal")) +
    diffScalar(idx.cum.creditSkill, s.curPass, tgt(s, "curPass", "tgtPass")) +
    diffScalar(idx.cum.creditSkill, s.curSub, tgt(s, "curSub", "tgtSub"));
  const star = diffScalar(idx.cum.creditStar, s.curStar, effectiveTgtStar(s));
  const lvTable = idx.cum.creditLevel;
  const col = (i) => Object.fromEntries(Object.entries(lvTable).map(([k, v]) => [k, v[i]]));
  const level = diffScalar(col(0), s.curLv, tgt(s, "curLv", "tgtLv"));
  // Unique-weapon level uses its own credit column, and its target derives from target
  // stars — this mirrors the final term of the sheet's credit formula.
  const uniq = diffScalar(col(1), s.curUniq, derivedUniq(effectiveTgtStar(s)));
  return { skill, star, level, uniq, total: skill + star + level + uniq };
}

function tgt(s, curKey, tgtKey) {
  const t = s[tgtKey];
  return t > 0 ? t : s[curKey];
}

export function effectiveTgtStar(s) {
  return s.tgtStar > 0 ? s.tgtStar : s.curStar;
}

/** Target unique level is not stored; it follows from target stars. */
export function derivedUniq(star) {
  if (star > 7) return 60;
  if (star > 6) return 50;
  if (star > 5) return 40;
  if (star > 4) return 30;
  return 0;
}

/* ------------------------------------------------------------------ */
/* per-student roll-up                                                  */
/* ------------------------------------------------------------------ */

export function computeStudent(idx, sid, s) {
  const levels = {};
  for (const key of SKILL_KEYS) {
    levels[key] = { from: s[CUR_KEY[key]], to: tgt(s, CUR_KEY[key], TGT_KEY[key]) };
  }
  const opart = opartCost(idx, sid, levels);
  const gear = [0, 1, 2].map((i) =>
    gearCost(idx, s[`curGear${i + 1}`], tgt(s, `curGear${i + 1}`, `tgtGear${i + 1}`))
  );
  const home = idx.students.get(sid)?.school || "(unclassified)";
  const collab = collabCost(idx, sid, levels);

  let bd, note, bdBySchool, noteBySchool;
  if (collab.has) {
    // Collab spans several schools, so the split is required to match against stock.
    bdBySchool = {};
    noteBySchool = {};
    for (const [sc, arr] of Object.entries(collab.bd)) bdBySchool[sc] = arr.slice(0, 4);
    for (const [sc, arr] of Object.entries(collab.note)) noteBySchool[sc] = arr.slice(0, 5);
    bd = sumInto([0, 0, 0, 0], Object.values(bdBySchool));
    note = sumInto([0, 0, 0, 0, 0], Object.values(noteBySchool));
  } else {
    bd = bdCost(idx, levels.EX.from, levels.EX.to);
    note = [levels.노말, levels.패시브, levels.서브]
      .map((l) => noteCost(idx, l.from, l.to))
      .reduce((a, b) => a.map((v, i) => v + b[i]));
    bdBySchool = bd.some(Boolean) ? { [home]: bd } : {};
    noteBySchool = note.some(Boolean) ? { [home]: note } : {};
  }

  return {
    sid,
    bd, note, bdBySchool, noteBySchool,
    isCollab: collab.has,
    opart: opart.req,
    opartMissing: opart.missing && !collab.has,
    gear: gear.map((g) => g.req),
    credit: (collab.has ? collab.credit + starLevelCredit(idx, s) : creditCost(idx, s).total)
            + gear.reduce((a, g) => a + g.credit, 0),
  };
}

function sumInto(acc, lists) {
  for (const l of lists) l.forEach((v, i) => { if (i < acc.length) acc[i] += v; });
  return acc;
}

/** Collab carries its own skill credits; star and level credits are shared, so add those. */
function starLevelCredit(idx, s) {
  const c = creditCost(idx, s);
  return c.star + c.level + c.uniq;
}

/**
 * Materials consumed between two states.
 *
 * Raising a current level means the upgrade actually happened in game, so that much was
 * spent. The amount equals the requirement computed with the old value as "current" and the
 * new one as "target" — so the already-verified computeStudent is reused rather than
 * reimplemented.
 */
export function consumption(idx, sid, before, after) {
  const synthetic = { ...before };
  for (const k of ["curStar", "curLv", "curUniq", "curEx", "curNormal", "curPass", "curSub",
                   "curGear1", "curGear2", "curGear3"]) {
    const tgt = k.replace(/^cur/, "tgt");
    synthetic[tgt] = after[k];
  }
  synthetic.own = 1;
  return computeStudent(idx, sid, synthetic);
}

/**
 * Totals across owned students.
 *
 * Blu-rays and notes are per-school currencies — both stock and requirement are tracked by
 * school. So a per-school breakdown is produced alongside the grand total; totalling alone
 * would hide "enough overall, short for that particular school".
 */
export function computeAll(idx, state) {
  const per = [];
  const totals = {
    bd: [0, 0, 0, 0],
    note: [0, 0, 0, 0, 0],
    opart: Array.from({ length: idx.materials.opart.length }, () => [0, 0, 0, 0]),
    gear: {},   // `${typeIndex}.${tier}` -> count
    credit: 0,
  };
  const bySchool = {};
  const missing = [];

  for (const [sidStr, arr] of Object.entries(state.students)) {
    const sid = Number(sidStr);
    const s = toObj(arr);
    if (!s.own) continue;
    const r = computeStudent(idx, sid, s);
    per.push(r);
    if (r.opartMissing) missing.push(sid);

    // computeStudent decides school attribution — own school normally, several for collab.
    const bucket = (sc) => bySchool[sc] || (bySchool[sc] = { bd: [0, 0, 0, 0], note: [0, 0, 0, 0, 0] });
    for (const [sc, arr] of Object.entries(r.bdBySchool || {})) {
      const b = bucket(sc);
      arr.forEach((v, i) => { if (i < 4) b.bd[i] += v; });
    }
    for (const [sc, arr] of Object.entries(r.noteBySchool || {})) {
      const b = bucket(sc || "(secret)");
      arr.forEach((v, i) => { b.note[i] += v; });
    }
    r.bd.forEach((v, i) => { totals.bd[i] += v; });
    r.note.forEach((v, i) => { totals.note[i] += v; });
    r.opart.forEach((row, mi) => row.forEach((v, g) => (totals.opart[mi][g] += v)));

    // Gear slots 1/2/3 hold different item types per student.
    const types = idx.students.get(sid)?.gear || [];
    r.gear.forEach((req, slot) => {
      const typeIdx = idx.gearTypeIndex.get(types[slot]);
      if (typeIdx === undefined) return;
      req.forEach((v, i) => {
        if (!v) return;
        const key = `${typeIdx}.${idx.gear.tierLabels[i]}`;
        totals.gear[key] = (totals.gear[key] || 0) + v;
      });
    });
    totals.credit += r.credit;
  }
  return { per, totals, bySchool, missing };
}

import { SLOTS } from "../state/schema.js";
function toObj(arr) {
  const o = {};
  SLOTS.forEach((sl, i) => { o[sl.key] = arr[i] ?? 0; });
  return o;
}
