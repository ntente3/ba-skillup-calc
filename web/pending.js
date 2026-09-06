/**
 * Deferred consumption: raising a current level accumulates the materials it
 * would spend, and stock is only debited when the user explicitly commits.
 *
 * Why not debit immediately: stock is hand-entered, and a single typo that
 * silently decremented it would leave no way to find where things went wrong.
 * Editing several students and committing once also matches how the tool is
 * actually used.
 *
 * Lowering a level never refunds. There is no way to tell a typo correction
 * from a genuine rollback, and auto-crediting stock would conjure materials
 * that were never owned. Instead, a commit can be undone wholesale right
 * after it happens.
 */

const CUR_FIELDS = ["curStar", "curLv", "curUniq", "curEx", "curNormal", "curPass", "curSub",
                    "curGear1", "curGear2", "curGear3"];

export function createPending(idx, getStudent) {
  /** sid -> state snapshot from before editing began: the baseline against
      which only upward deltas are accumulated. */
  const base = new Map();
  let undo = null;   // stock snapshot taken at the last commit

  return {
    /** Record the pre-edit state. Keep any existing entry: the baseline must
        remain the first one taken. */
    mark(sid) {
      if (!base.has(sid)) base.set(sid, { ...getStudent(sid) });
    },

    /** Keep only students that moved up relative to their baseline. */
    changed() {
      const out = [];
      for (const [sid, before] of base) {
        const after = getStudent(sid);
        if (CUR_FIELDS.some((k) => (after[k] || 0) > (before[k] || 0))) out.push({ sid, before, after });
      }
      return out;
    },

    count() { return this.changed().length; },

    /** Material totals across everything pending, shown up front so the user
        knows what is about to be deducted. */
    total(consumption) {
      const acc = { bd: {}, note: {}, opart: {}, gear: {}, credit: 0 };
      for (const { sid, before, after } of this.changed()) {
        const r = consumption(idx, sid, before, after);
        const school = idx.students.get(sid)?.school || "(미분류)";
        r.bd.forEach((v, i) => { if (v) acc.bd[`bd.${school}.${i}`] = (acc.bd[`bd.${school}.${i}`] || 0) + v; });
        r.note.forEach((v, i) => { if (v && i < 4) acc.note[`note.${school}.${i}`] = (acc.note[`note.${school}.${i}`] || 0) + v; });
        r.opart.forEach((row, mi) => row.forEach((v, g) => {
          if (v) acc.opart[`op.${mi}.${g}`] = (acc.opart[`op.${mi}.${g}`] || 0) + v;
        }));
        const types = idx.students.get(sid)?.gear || [];
        r.gear.forEach((req, slot) => {
          const ti = idx.gearTypeIndex.get(types[slot]);
          if (ti === undefined) return;
          req.forEach((v, i) => {
            if (!v) return;
            const k = `eq.${ti}.${idx.gear.tierLabels[i]}`;
            acc.gear[k] = (acc.gear[k] || 0) + v;
          });
        });
        acc.credit += r.credit;
      }
      return acc;
    },

    /**
     * Debit stock for real. When stock is short this goes negative rather
     * than clamping at zero: the negative amount records "this much was
     * acquired without being logged", and entering the real count later
     * reconciles on its own.
     */
    apply(inv, consumption) {
      const totals = this.total(consumption);
      const before = { ...inv };
      const short = [];
      for (const group of [totals.bd, totals.note, totals.opart, totals.gear]) {
        for (const [key, qty] of Object.entries(group)) {
          const next = (inv[key] || 0) - qty;
          inv[key] = next;
          if (next < 0) short.push({ key, by: -next });
        }
      }
      undo = before;
      base.clear();
      return { short, credit: totals.credit };
    },

    /** Undo the whole commit: restores stock only, leaves levels alone. */
    revert(inv) {
      if (!undo) return false;
      for (const k of Object.keys(inv)) delete inv[k];
      Object.assign(inv, undo);
      undo = null;
      return true;
    },

    canRevert() { return undo !== null; },

    /** Discard what is pending: level edits stay, stock is left untouched. */
    discard() { base.clear(); },

    /** Call after a state swap that is not an upgrade (import, migration). */
    reset() { base.clear(); undo = null; },
  };
}
