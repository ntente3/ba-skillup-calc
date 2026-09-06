/**
 * Multi-axis filtering.
 *
 * The workbook could only filter by school. Driving 269 students x 20 fields
 * from one screen needs the same axes the game itself offers: attack type,
 * defense type, weapon, position, role and rarity.
 *
 * Rule: OR within a group, AND across groups.
 * (e.g. attack [Explosive, Piercing] + defense [Light] means
 *  "Explosive or Piercing" AND "Light armor".)
 * A group with nothing selected imposes no constraint.
 */

export const GROUPS = [
  { key: "school",   label: "학교",   from: (s, t) => s.school },
  { key: "bullet",   label: "공격",   from: (s, t) => t?.bullet },
  { key: "armor",    label: "방어",   from: (s, t) => t?.armor },
  { key: "weapon",   label: "무기",   from: (s, t) => t?.weapon },
  { key: "position", label: "포지션", from: (s, t) => t?.position },
  { key: "squad",    label: "구분",   from: (s, t) => t?.squad },
  { key: "role",     label: "역할",   from: (s, t) => t?.role },
  // Intrinsic character rarity (1-3). Distinct from the player-raised star
  // level (1-8) below, so the two carry different labels.
  { key: "star",     label: "희귀도", from: (s, t) => t?.star ?? s.star },
  // Progression-based: read from user state, not from the game data.
  { key: "curStar",  label: "현재 ★", state: true },
];

/**
 * Display order for enum groups. Sorting alphabetically would drop "none"
 * into the middle of the defense types and generally break the ordering
 * players already know from the game.
 */
const ORDER = {
  bullet:   ["Explosion", "Pierce", "Mystic", "Sonic"],
  armor:    ["LightArmor", "HeavyArmor", "CompositeArmor", "ElasticArmor", "Unarmed"],
  position: ["Front", "Middle", "Back"],
  squad:    ["Main", "Support"],
  role:     ["DamageDealer", "Tanker", "Healer", "Supporter", "Vehicle"],
  weapon:   ["AR", "SMG", "SR", "HG", "SG", "MG", "RL", "GL", "RG", "MT", "FT"],
};

export function createFilters(game, getStar) {
  const tags = game.tags?.tags || {};
  const labels = game.tags?.labels || {};

  /** Build options only from values that actually occur; an axis absent from
      the data has nothing worth showing. */
  const options = {};
  for (const g of GROUPS) {
    if (g.state) {
      // Current star is a fixed 1-8 range: it must be selectable even before
      // the user has entered anything.
      options[g.key] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: `${n}★` }));
      continue;
    }
    const seen = new Map();
    for (const s of game.students) {
      const v = g.from(s, tags[String(s.sid)]);
      if (v == null || v === "") continue;
      if (!seen.has(v)) seen.set(v, labelOf(labels, g.key, v));
    }
    options[g.key] = [...seen.entries()].map(([value, label]) => ({ value, label }));
    const fixed = ORDER[g.key];
    if (g.key === "school") {
      const rank = new Map((game.schools || []).map((s, i) => [s, i]));
      options[g.key].sort((a, b) => (rank.get(a.value) ?? 999) - (rank.get(b.value) ?? 999));
    } else if (fixed) {
      const rank = new Map(fixed.map((v, i) => [v, i]));
      options[g.key].sort((a, b) => (rank.get(a.value) ?? 999) - (rank.get(b.value) ?? 999));
    } else {
      options[g.key].sort((a, b) => Number(a.value) - Number(b.value) || a.label.localeCompare(b.label, "ko"));
    }
  }

  const active = Object.fromEntries(GROUPS.map((g) => [g.key, new Set()]));

  return {
    options,
    active,
    tags,
    labels,
    count: () => GROUPS.reduce((n, g) => n + active[g.key].size, 0),
    clear: () => GROUPS.forEach((g) => active[g.key].clear()),
    toggle(key, value) {
      const set = active[key];
      set.has(value) ? set.delete(value) : set.add(value);
    },
    /** Does one student pass the active filter set? */
    match(student) {
      const t = tags[String(student.sid)];
      for (const g of GROUPS) {
        const set = active[g.key];
        if (!set.size) continue;
        const v = g.state ? getStar?.(student.sid) : g.from(student, t);
        if (!set.has(String(v))) return false;
      }
      return true;
    },
  };
}

function labelOf(labels, key, value) {
  const map = labels[key];
  if (map && map[value]) return map[value];
  return key === "star" ? `${value}★` : String(value);
}

/** Filter bar markup: one row of chips per group. */
export function renderFilterBar(f) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = GROUPS.filter((g) => (f.options[g.key] || []).length > 1).map((g) => {
    const chips = f.options[g.key].map((o) =>
      `<button class="chip" data-fk="${g.key}" data-fv="${esc(o.value)}"
        aria-pressed="${f.active[g.key].has(String(o.value))}">${esc(o.label)}</button>`).join("");
    return `<div class="frow"><span class="fkey">${esc(g.label)}</span><div class="fchips">${chips}</div></div>`;
  }).join("");
  const n = f.count();
  return `<div class="filterbar">${rows}
    <div class="frow ftail">
      <span class="fkey"></span>
      <div class="fchips">
        <button class="chip clear" data-clear="1"${n ? "" : " disabled"}>필터 초기화${n ? ` (${n})` : ""}</button>
      </div>
    </div>
  </div>`;
}
