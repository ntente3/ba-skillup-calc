/**
 * User state schema, version 1.
 *
 * There is no server, so migration is entirely the client's job. Two rules are therefore
 * contracts rather than conventions:
 *
 *   1. SLOTS is append-only. Never reorder, remove, or repurpose an entry — the array
 *      index *is* the storage format.
 *   2. Students are keyed by a stable integer id, never by name. Names change with game
 *      patches, and the moment one does, that student's entries vanish silently.
 */

export const SCHEMA_VERSION = 1;
export const MAGIC = "BA";

/** One student's state. The index is the storage format — never reorder. */
export const SLOTS = [
  { key: "own",       label: "owned",        max: 1  },
  { key: "curStar",   label: "현재 ★",      max: 8  },
  { key: "curLv",     label: "현재 캐릭Lv", max: 90 },
  { key: "curUniq",   label: "현재 고유Lv", max: 60 },
  { key: "curEx",     label: "현재 EX",     max: 5  },
  { key: "curNormal", label: "현재 노말",   max: 10 },
  { key: "curPass",   label: "현재 패시브", max: 10 },
  { key: "curSub",    label: "현재 서브",   max: 10 },
  { key: "tgtStar",   label: "목표 ★",      max: 8  },
  { key: "tgtLv",     label: "목표 캐릭Lv", max: 90 },
  { key: "tgtEx",     label: "목표 EX",     max: 5  },
  { key: "tgtNormal", label: "목표 노말",   max: 10 },
  { key: "tgtPass",   label: "목표 패시브", max: 10 },
  { key: "tgtSub",    label: "목표 서브",   max: 10 },
  { key: "curGear1",  label: "현재 장비1",  max: 10 },
  { key: "curGear2",  label: "현재 장비2",  max: 10 },
  { key: "curGear3",  label: "현재 장비3",  max: 10 },
  { key: "tgtGear1",  label: "목표 장비1",  max: 10 },
  { key: "tgtGear2",  label: "목표 장비2",  max: 10 },
  { key: "tgtGear3",  label: "목표 장비3",  max: 10 },
];

export const SLOT_INDEX = Object.fromEntries(SLOTS.map((s, i) => [s.key, i]));

/**
 * Derived values, deliberately not stored. These were formulas in the spreadsheet and are
 * functions here. Storing them would let a user's saved data hold a stale value after the
 * rule that produces it changes.
 */
export const DERIVED = {
  /** Target unique level follows from target stars (same rule as the sheet's formula). */
  tgtUniq: (s) => {
    const star = s.tgtStar || s.curStar;
    if (star > 7) return 60;
    if (star > 6) return 50;
    if (star > 5) return 40;
    if (star > 4) return 30;
    return 0;
  },
  /** Unset target stars (0) means "same as current". */
  effectiveTgtStar: (s) => s.tgtStar || s.curStar,
};

export function emptyStudent() {
  return new Array(SLOTS.length).fill(0);
}

export function toObject(arr) {
  const o = {};
  SLOTS.forEach((s, i) => { o[s.key] = arr[i] ?? 0; });
  return o;
}

export function fromObject(obj) {
  return SLOTS.map((s) => obj[s.key] ?? 0);
}

/** Clamp out-of-range values so a corrupted import cannot poison the calculation. */
export function clampStudent(arr) {
  const out = emptyStudent();
  for (let i = 0; i < SLOTS.length; i++) {
    const v = Number(arr[i]);
    out[i] = !Number.isFinite(v) ? 0 : Math.max(0, Math.min(SLOTS[i].max, Math.trunc(v)));
  }
  return out;
}

/** All-default students carry no information and are not serialized. */
export function isEmptyStudent(arr) {
  return arr.every((v) => !v);
}
