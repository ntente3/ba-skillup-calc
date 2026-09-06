/**
 * Game data loading.
 *
 * The repository root doubles as the deploy root: no build step, no copy step.
 * The trade-off is that opening index.html over file:// makes fetch fail on
 * CORS, so a local static server is required (npm run dev).
 */
const BASE = new URL("../data/", import.meta.url);

async function j(name) {
  const res = await fetch(new URL(name, BASE));
  if (!res.ok) throw new Error(`${name} 를 불러오지 못했습니다 (HTTP ${res.status})`);
  return res.json();
}

/** Icons are optional: fall back to text labels rather than failing to boot. */
async function icons() {
  try {
    const res = await fetch(new URL("../web/icons/index.json", import.meta.url));
    return res.ok ? await res.json() : { opart: {}, gear: {} };
  } catch {
    return { opart: {}, gear: {} };
  }
}

/** Attribute tags are optional too; without them only school and star filters appear. */
async function tags() {
  try {
    const res = await fetch(new URL("game/tags.json", BASE));
    return res.ok ? await res.json() : { labels: {}, tags: {} };
  } catch {
    return { labels: {}, tags: {} };
  }
}

export async function loadGame() {
  const [students, skillCosts, cumulative, gear, materials, schools, collab, iconIndex, tagData] = await Promise.all([
    j("game/students.json"),
    j("game/skill_costs.json"),
    j("game/cumulative.json"),
    j("game/gear.json"),
    j("game/materials.json"),
    j("game/schools.json"),
    j("game/collab.json"),
    icons(),
    tags(),
  ]);
  return { students, skillCosts, cumulative, gear, materials, schools, collab, iconIndex, tags: tagData };
}
