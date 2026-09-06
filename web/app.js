/**
 * Application shell — no-build vanilla ES modules.
 *
 * Render strategy: the ~270 student rows are built once and never rebuilt.
 * Re-rendering on every input would tear down 270 rows x 20 inputs = 5,400
 * nodes per keystroke. Instead, event delegation mutates state and only what
 * actually changed (the totals panel, and that row's dimming) is refreshed.
 * Filters toggle `hidden` rather than removing rows, so focus and scroll
 * position survive.
 */
import { loadGame } from "./data.js";
import { buildIndex, computeAll, derivedUniq, effectiveTgtStar } from "../src/core/calc.js";
import { SLOTS, SLOT_INDEX, emptyStudent } from "../src/state/schema.js";
import { normalize, encodeFile, decodeFile, LoadError } from "../src/state/codec.js";
import { consumption } from "../src/core/calc.js";
import { createFilters, renderFilterBar } from "./filters.js";
import { createPending } from "./pending.js";

const STORAGE_KEY = "ba-skillup-state-v1";
const $ = (s, r = document) => r.querySelector(s);

let GAME, IDX, STATE, ROWS = new Map();
let FILTERS, PENDING;

/** Bulk target presets. Values are ordered EX / Normal / Passive / Sub. */
const SKILL_PRESETS = [
  { label: "3/5/5/5", v: [3, 5, 5, 5] },
  { label: "4/7/7/7", v: [4, 7, 7, 7] },
  { label: "5/9/9/9", v: [5, 9, 9, 9] },
  { label: "5/10/10/10", v: [5, 10, 10, 10] },
];
const GEAR_PRESETS = [
  { label: "T5", v: 5 }, { label: "T7", v: 7 }, { label: "T9", v: 9 }, { label: "T10", v: 10 },
];

/** Collapsed state of each column group. */
const COLS = { cur: true, tgt: true, gear: true };

/* ---------------- state ---------------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return decodeFile(raw);
  } catch (e) {
    console.warn("저장된 상태를 읽지 못했습니다:", e);
  }
  return { v: 1, students: {}, inv: {}, schools: {} };
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, encodeFile(STATE));
      hint("저장됨");
    } catch (e) {
      // Quota exceeded, or private browsing. Say so before the user loses work.
      hint("자동 저장 실패 — 내보내기로 백업하세요", true);
    }
  }, 400);
}

function hint(text, bad = false) {
  const el = $("#savehint");
  el.textContent = text;
  el.style.color = bad ? "var(--danger)" : "var(--faint)";
}

const toObj = (arr) => Object.fromEntries(SLOTS.map((sl, i) => [sl.key, arr[i] ?? 0]));

function stu(sid) {
  const k = String(sid);
  let a = STATE.students[k];
  if (!a) a = STATE.students[k] = emptyStudent();
  while (a.length < SLOTS.length) a.push(0);
  return a;
}

/* ---------------- student table ---------------- */

const CUR_COLS = ["curStar", "curLv", "curUniq", "curEx", "curNormal", "curPass", "curSub"];
const TGT_COLS = ["tgtStar", "tgtLv", "tgtEx", "tgtNormal", "tgtPass", "tgtSub"];

function buildTable() {
  const tbl = $("#tbl");
  const head = `
    <thead>
      <tr>
        <th rowspan="2">학생</th>
        <th rowspan="2">보유</th>
        <th class="grp c-cur" colspan="7">현재</th>
        <th class="grp c-tgt" colspan="6">목표</th>
        <th class="grp c-gear" colspan="3">현재 장비</th>
        <th class="grp c-gear" colspan="3">목표 장비</th>
      </tr>
      <tr>
        <th class="grp c-cur">★</th><th class="c-cur">Lv</th><th class="c-cur">고유</th><th class="c-cur">EX</th><th class="c-cur">노말</th><th class="c-cur">패시브</th><th class="c-cur">서브</th>
        <th class="grp c-tgt">★</th><th class="c-tgt">Lv</th><th class="c-tgt">EX</th><th class="c-tgt">노말</th><th class="c-tgt">패시브</th><th class="c-tgt">서브</th>
        <th class="grp c-gear">1</th><th class="c-gear">2</th><th class="c-gear">3</th>
        <th class="grp c-gear">1</th><th class="c-gear">2</th><th class="c-gear">3</th>
      </tr>
    </thead>`;

  const body = [];
  let school = null;
  for (const s of sortedStudents()) {
    if (s.school !== school) {
      school = s.school;
      body.push(`<tr class="schoolrow" data-school="${esc(school)}"><td colspan="20">${esc(school)}</td></tr>`);
    }
    const a = stu(s.sid);
    const cells = [];
    cells.push(`<td class="name" title="${esc(s.name)}">${esc(s.name)}</td>`);
    cells.push(`<td><input type="checkbox" data-sid="${s.sid}" data-k="own"${a[SLOT_INDEX.own] ? " checked" : ""}></td>`);
    CUR_COLS.forEach((k, i) => cells.push(numCell(s.sid, k, a, `c-cur${i === 0 ? " sep" : ""}`)));
    TGT_COLS.forEach((k, i) => cells.push(numCell(s.sid, k, a, `c-tgt${i === 0 ? " sep" : ""}`, true)));
    [1, 2, 3].forEach((n, i) => cells.push(numCell(s.sid, `curGear${n}`, a, `c-gear${i === 0 ? " sep" : ""}`, false, s.gear?.[i])));
    [1, 2, 3].forEach((n, i) => cells.push(numCell(s.sid, `tgtGear${n}`, a, `c-gear${i === 0 ? " sep" : ""}`, true, s.gear?.[i])));
    body.push(`<tr data-sid="${s.sid}" data-name="${esc(s.name)}" data-school="${esc(school)}"${a[SLOT_INDEX.own] ? "" : ' class="off"'}>${cells.join("")}</tr>`);
  }
  tbl.innerHTML = head + "<tbody>" + body.join("") + "</tbody>";

  for (const tr of tbl.querySelectorAll("tbody tr[data-sid]")) ROWS.set(Number(tr.dataset.sid), tr);

  tbl.addEventListener("input", onEdit);
  tbl.addEventListener("change", onEdit);
}

/**
 * Group and sort students by school.
 *
 * The source sheet lists students in the game's internal order, not by
 * school. Inserting separator rows by comparing neighbours without sorting
 * first yields 148 separators among 269 students. School order is taken
 * verbatim from the block order of the calculation sheet.
 */
function sortedStudents() {
  const rank = new Map((GAME.schools || []).map((s, i) => [s, i]));
  return GAME.students
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ra = rank.get(a.s.school) ?? 999;
      const rb = rank.get(b.s.school) ?? 999;
      return ra !== rb ? ra - rb : a.i - b.i;
    })
    .map((x) => x.s);
}

function numCell(sid, key, arr, extra = "", isTgt = false, title = "") {
  const slot = SLOTS[SLOT_INDEX[key]];
  const v = arr[SLOT_INDEX[key]] || 0;
  const dis = key === "curUniq" ? "" : "";
  return `<td class="${extra.trim()}"><input class="num${isTgt ? " tgt" : ""}" type="number" min="0" max="${slot.max}"
    data-sid="${sid}" data-k="${key}" value="${v || ""}" placeholder="0"${title ? ` title="${esc(title)}"` : ""}${dis}></td>`;
}

function onEdit(e) {
  const el = e.target;
  const sid = Number(el.dataset.sid);
  const key = el.dataset.k;
  if (!sid || !key) return;
  // Snapshot the state just before a current-level edit; this is the
  // baseline for deferred consumption.
  if (key.startsWith("cur")) PENDING?.mark(sid);
  const a = stu(sid);
  const i = SLOT_INDEX[key];

  if (el.type === "checkbox") {
    a[i] = el.checked ? 1 : 0;
    ROWS.get(sid)?.classList.toggle("off", !el.checked);
  } else {
    const max = SLOTS[i].max;
    let n = Math.trunc(Number(el.value));
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > max) { n = max; el.value = String(n); }
    a[i] = n;
  }
  saveSoon();
  refreshSoon();
  renderPendingBar();
  if (key === "curStar" && FILTERS?.active.curStar.size) applyFilter();
}

/* ---------------- column group collapse ---------------- */

/**
 * Toggle `hidden` instead of removing columns. Rebuilding would drop focus
 * mid-edit and reset scroll position.
 */
function applyColumns() {
  const tbl = $("#tbl");
  for (const g of ["cur", "tgt", "gear"]) {
    tbl.classList.toggle(`hide-${g}`, !COLS[g]);
  }
  for (const b of document.querySelectorAll("#colgroups button")) {
    b.setAttribute("aria-pressed", String(COLS[b.dataset.col]));
  }
}

/* ---------------- bulk target presets ---------------- */

/**
 * Applies only to students currently visible. The filter *is* the selection:
 * a separate checkbox selection would drift out of sync with the filter and
 * leave the user unsure which set a preset actually hit.
 */
function applyPreset(fields, values) {
  const targets = [...ROWS].filter(([, tr]) => !tr.classList.contains("hidden"));
  if (!targets.length) return banner("적용할 학생이 없습니다 — 필터를 확인하세요.", "err");
  let n = 0;
  for (const [sid, tr] of targets) {
    const a = stu(sid);
    if (!a[SLOT_INDEX.own]) continue;
    fields.forEach((f, i) => { a[SLOT_INDEX[f]] = values[i] ?? values[0]; });
    for (const el of tr.querySelectorAll("[data-k]")) {
      const idx = SLOT_INDEX[el.dataset.k];
      if (fields.includes(el.dataset.k)) el.value = a[idx] || "";
    }
    n++;
  }
  saveSoon();
  refresh();
  banner(`보유 학생 ${n}명의 목표를 일괄 지정했습니다.`, "ok");
}

/* ---------------- deferred consumption ---------------- */

/**
 * Pending-consumption banner.
 *
 * Two hazards here.
 *  1) Pressing a button blurs the input, so `change` fires first. Re-rendering
 *     the banner at that moment removes the button mid-click and the click
 *     never lands. -> Only re-render when the markup actually differs.
 *  2) The banner can still be replaced, so the handler is delegated once to
 *     the container rather than bound to the buttons.
 */
let pendSig = null;

function pendingHtml() {
  const n = PENDING.count();
  if (!n && !PENDING.canRevert()) return "";
  if (!n) {
    return `<div class="notice ok pend">
      <span><b>소모를 재고에 반영했습니다.</b></span>
      <button class="act" data-pend="revert">되돌리기</button></div>`;
  }
  const t = PENDING.total(consumption);
  const kinds = Object.keys(t.bd).length + Object.keys(t.note).length +
                Object.keys(t.opart).length + Object.keys(t.gear).length;
  return `<div class="notice pend">
    <span><b>강화 ${n}명 · 미반영 소모</b>소재 ${kinds}종${t.credit ? ` · 크레딧 ${fmt(t.credit)}` : ""} 을 재고에서 뺍니다.</span>
    <button class="act primary" data-pend="apply">재고에 반영</button>
    <button class="act" data-pend="discard">무시</button></div>`;
}

function renderPendingBar() {
  const html = pendingHtml();
  if (html === pendSig) return;      // identical markup: leave the DOM alone
  pendSig = html;
  $("#pending-bar").innerHTML = html;
}

/** Delegated once to the container, so it survives inner replacement. */
function wirePendingBar() {
  $("#pending-bar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pend]");
    if (!b) return;
    const act = b.dataset.pend;
    if (act === "apply") {
      const { short } = PENDING.apply(STATE.inv, consumption);
      saveSoon(); refresh(); renderInventory();
      if (short.length) {
        banner(`재고가 모자란 소재 ${short.length}종이 음수로 남았습니다 — 기록하지 않은 획득이 있을 수 있습니다.`, "err");
      }
    } else if (act === "discard") {
      PENDING.discard();
    } else if (act === "revert") {
      PENDING.revert(STATE.inv);
      saveSoon(); refresh(); renderInventory();
    }
    renderPendingBar();
  });
}

/* ---------------- filters ---------------- */

function applyFilter() {
  const q = $("#q").value.trim().toLowerCase();
  const onlyOwn = $("#only-own").checked;
  const onlyNeed = $("#only-need").checked;

  const needing = onlyNeed ? new Set(lastResult.per.filter(hasNeed).map((r) => r.sid)) : null;

  let shown = 0;
  const seenSchool = new Set();
  for (const [sid, tr] of ROWS) {
    const a = stu(sid);
    let ok = true;
    if (q && !tr.dataset.name.toLowerCase().includes(q)) ok = false;
    if (ok && FILTERS && !FILTERS.match(IDX.students.get(sid) || {})) ok = false;
    if (ok && onlyOwn && !a[SLOT_INDEX.own]) ok = false;
    if (ok && needing && !needing.has(sid)) ok = false;
    tr.classList.toggle("hidden", !ok);
    if (ok) { shown++; seenSchool.add(tr.dataset.school); }
  }
  for (const tr of document.querySelectorAll("tr.schoolrow")) {
    tr.classList.toggle("hidden", !seenSchool.has(tr.dataset.school));
  }
  $("#count").textContent = `${shown} / ${ROWS.size}명`;
}

function hasNeed(r) {
  return r.bd.some(Boolean) || r.note.some(Boolean) ||
         r.opart.some((row) => row.some(Boolean)) ||
         r.gear.some((g) => g.some(Boolean)) || r.credit > 0;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => (n || 0).toLocaleString("ko-KR");

/* ---------------- totals ---------------- */

let lastResult = { per: [], totals: null, bySchool: {}, missing: [] };
let refreshTimer = null;

function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
}

function refresh() {
  lastResult = computeAll(IDX, STATE);
  renderRail();
  if ($("#only-need").checked) applyFilter();
}

/**
 * One material row.
 *
 * The number column means exactly one thing: the shortfall. Putting "required"
 * there when satisfied and "short by" when not would flip the meaning of the
 * same position depending on state, forcing the reader to re-derive it every
 * time. Required and owned move to the fill bar (shape) and the title
 * (detail), where they cost no width.
 *
 * Why glyphs instead of +/- signs: the original workbook computes
 * `required - owned`, so positive means short; conventional inventory math is
 * `owned - required`, so negative means short. The two conventions point
 * opposite ways, and whichever is chosen, one group of users reads the sign
 * backwards. A glyph carries no such ambiguity.
 */
/** An icon <img>, or an empty slot. Keys use the same shape as stock keys
    (op.<material>.<grade>, eq.<type>.<tier>). */
function icon(key) {
  if (!key) return "";
  const [kind, a, b] = key.split(".");
  const map = kind === "op" ? GAME.iconIndex?.opart : kind === "eq" ? GAME.iconIndex?.gear : null;
  const file = map?.[`${a}.${b}`];
  return file ? `<img class="ico" src="web/icons/${file}" alt="" loading="lazy">` : "";
}

function row(label, need, key) {
  const have = key ? (STATE.inv[key] || 0) : null;
  const short = have === null ? 0 : Math.max(0, need - have);
  const cls = !need ? "zero" : short > 0 ? "lack" : "done";
  const fill = !need ? 0 : Math.min(100, Math.round(((have ?? 0) / need) * 100));

  const tip = have === null
    ? `필요 ${fmt(need)} · 보유량 미관리`
    : `필요 ${fmt(need)} · 보유 ${fmt(have)} · ${short > 0 ? `부족 ${fmt(short)}` : `여유 ${fmt(have - need)}`}`;

  // The right-hand number holds only what still has to be done. When the
  // requirement is met there is nothing to do, so it stays empty: the check
  // mark and the green bar already say so, and a third "met" would be the
  // same statement three times over.
  const mark = !need ? "·" : short > 0 ? "▲" : "✓";
  const val = short > 0 ? fmt(short) : "";

  return `<div class="totrow ${cls}${DETAIL ? " detail" : ""}" style="--fill:${fill}%" title="${esc(tip)}">
    <span class="mark">${mark}</span>
    <span class="lbl">${icon(key)}${esc(label)}</span>
    ${DETAIL ? `<span class="need">${fmt(need)}${have === null ? "" : ` / ${fmt(have)}`}</span>` : ""}
    <span class="val">${val}</span>
  </div>`;
}

const groupHead = (name) =>
  `<div class="totrow" style="border-bottom:none;padding-bottom:2px">
     <span class="mark"></span><span class="lbl grouphead">${esc(name)}</span>
     ${DETAIL ? "<span></span>" : ""}<span></span>
   </div>`;

/** Show only shortfalls, or everything. Defaults to shortfalls only, so the
    list holds just what needs acting on. */
let DETAIL = false;
let SHORT_ONLY = true;

const isShort = (need, key) => need > 0 && need - (key ? (STATE.inv[key] || 0) : 0) > 0;

/** Visibility filter. In shortfall-only mode this keeps short rows and their
    group headers. */
function rowsFor(items) {
  const keep = SHORT_ONLY ? items.filter((it) => it.head || isShort(it.need, it.key)) : items;
  // Drop group headers left with no materials behind them
  const out = [];
  for (let i = 0; i < keep.length; i++) {
    if (keep[i].head && (i + 1 >= keep.length || keep[i + 1].head)) continue;
    out.push(keep[i]);
  }
  return out;
}

const renderRows = (items) => {
  const list = rowsFor(items);
  if (!list.length) return emptyRow();
  return list.map((it) => (it.head ? groupHead(it.head) : row(it.label, it.need, it.key))).join("");
};

const shortCount = (items) => items.filter((it) => !it.head && isShort(it.need, it.key)).length;

const badge = (items) => {
  const n = shortCount(items);
  return n ? `<span class="badge">부족 ${n}</span>` : "";
};

function renderRail() {
  const t = lastResult.totals;
  const m = GAME.materials;
  const out = [];

  out.push(`<div class="railtools">
    <div class="seg">
      <button data-mode="short" aria-pressed="${SHORT_ONLY}">부족만</button>
      <button data-mode="all" aria-pressed="${!SHORT_ONLY}">전체</button>
    </div>
    <div class="seg"><button data-detail="1" aria-pressed="${DETAIL}">필요/보유</button></div>
  </div>`);

  out.push(`<div class="bigstat"><span class="k">필요 크레딧</span><span class="v">${fmt(t.credit)}</span></div>`);

  if (lastResult.missing.length) {
    const names = lastResult.missing.map((sid) => IDX.students.get(sid)?.name || `sid ${sid}`);
    out.push(`<div class="notice"><b>소재 데이터가 없는 학생 ${names.length}명</b>
      ${esc(names.slice(0, 4).join(", "))}${names.length > 4 ? " 외" : ""} — 게임 데이터에 아직 없어 오파츠 소요가 빠져 있습니다.</div>`);
  }

  // Follow the in-game school order. Sorting alphabetically would diverge
  // from the calculation sheet, so anyone reading the workbook alongside this
  // would have to re-locate every row.
  const rank = new Map((GAME.schools || []).map((s, i) => [s, i]));
  const schools = Object.keys(lastResult.bySchool)
    .sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999) || a.localeCompare(b, "ko"));

  const bdItems = [], noteItems = [];
  for (const sc of schools) {
    const b = lastResult.bySchool[sc];
    if (b.bd.some(Boolean)) {
      bdItems.push({ head: sc });
      m.bdGrades.forEach((g, i) => { if (b.bd[i]) bdItems.push({ label: g, need: b.bd[i], key: `bd.${sc}.${i}` }); });
    }
    if (b.note.some(Boolean)) {
      noteItems.push({ head: sc });
      m.noteGrades.forEach((g, i) => {
        if (b.note[i]) noteItems.push({ label: g, need: b.note[i], key: i < 4 ? `note.${sc}.${i}` : null });
      });
    }
  }

  const opItems = [];
  t.opart.forEach((grades, mi) => {
    grades.forEach((need, g) => {
      if (need) opItems.push({ label: `${m.opart[mi]} ${g + 1}`, need, key: `op.${mi}.${g}` });
    });
  });

  const gearItems = Object.entries(t.gear)
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([k, need]) => {
      const [ti, tier] = k.split(".");
      return { label: `${GAME.gear.types[ti] || `종류${ti}`} T${tier}`, need, key: `eq.${ti}.${tier}` };
    });

  const section = (title, items) =>
    `<section><h2>${esc(title)}${badge(items)}</h2><div class="totbox">${renderRows(items)}</div></section>`;

  if (bdItems.length) out.push(section("BD (학교별)", bdItems));
  if (noteItems.length) out.push(section("노트 (학교별)", noteItems));
  out.push(section("오파츠", opItems));
  out.push(section("장비", gearItems));

  const rail = $("#rail");
  rail.innerHTML = out.join("");
  rail.querySelectorAll("[data-mode]").forEach((b) => {
    b.onclick = () => { SHORT_ONLY = b.dataset.mode === "short"; renderRail(); };
  });
  rail.querySelector("[data-detail]").onclick = () => { DETAIL = !DETAIL; renderRail(); };
}

const emptyRow = () => `<div class="totrow zero"><span class="mark">·</span><span class="lbl">${SHORT_ONLY ? "부족한 소재 없음" : "소요 없음"}</span>${DETAIL ? "<span></span>" : ""}<span class="val"></span></div>`;

/* ---------------- stock on hand ---------------- */

const orderedSchools = () => [...new Set(sortedStudents().map((s) => s.school))].filter(Boolean);

function renderInventory() {
  const m = GAME.materials;
  const schools = orderedSchools();
  const out = [];

  const grid = (title, head, rows) => `
    <section style="margin-bottom:22px">
      <h2 style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:0 0 8px">${esc(title)}</h2>
      <div class="invgrid" style="grid-template-columns:minmax(90px,1fr) repeat(${head.length},72px)">
        <div class="h"></div>${head.map((h) => `<div class="h">${esc(h)}</div>`).join("")}
        ${rows}
      </div>
    </section>`;

  const cell = (key) => `<div><input type="number" min="0" data-inv="${esc(key)}" value="${STATE.inv[key] || ""}" placeholder="0"></div>`;
  const rowLabel = (key, name) => `<div>${icon(key)}${esc(name)}</div>`;

  out.push(grid("BD (학교별)", m.bdGrades,
    schools.map((sc) => `<div>${esc(sc)}</div>` + m.bdGrades.map((_, g) => cell(`bd.${sc}.${g}`)).join("")).join("")));

  out.push(grid("노트 (학교별)", m.bdGrades,
    schools.map((sc) => `<div>${esc(sc)}</div>` + m.bdGrades.map((_, g) => cell(`note.${sc}.${g}`)).join("")).join("")));

  out.push(grid("오파츠", ["1", "2", "3", "4"],
    m.opart.map((name, mi) => rowLabel(`op.${mi}.0`, name) + [0, 1, 2, 3].map((g) => cell(`op.${mi}.${g}`)).join("")).join("")));

  const tiers = GAME.gear.tierLabels;
  out.push(grid("장비", tiers.map((t) => `T${t}`),
    (GAME.gear.types || []).map((name, ti) => rowLabel(`eq.${ti}.2`, name) + tiers.map((t) => cell(`eq.${ti}.${t}`)).join("")).join("")));

  const el = $("#inv");
  el.innerHTML = out.join("");
  el.oninput = (e) => {
    const key = e.target.dataset.inv;
    if (!key) return;
    const n = Math.max(0, Math.trunc(Number(e.target.value) || 0));
    if (n) STATE.inv[key] = n; else delete STATE.inv[key];
    saveSoon();
    refreshSoon();
  };
}

/* ---------------- export / import ---------------- */

function doExport() {
  const blob = new Blob([encodeFile(STATE)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ba-skillup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  hint("내보냈습니다");
}

async function doImport(file) {
  try {
    const loaded = decodeFile(await file.text());
    const known = new Set(GAME.students.map((s) => s.sid));
    const orphans = Object.keys(loaded.students).filter((k) => !known.has(Number(k)));

    STATE = loaded;
    // An import is not an upgrade: clear the baseline so nothing registers
    // as consumption.
    PENDING.reset();
    // Unknown sids are kept, not discarded: they must come back when the
    // game data is updated.
    reloadInputsFromState();
    saveSoon();
    refresh();
    renderInventory();
    renderPendingBar();

    const n = Object.keys(loaded.students).length;
    banner(`${n}명 복원${orphans.length ? `, ${orphans.length}명 보류(알 수 없는 ID — 보관됨)` : ""}`,
           orphans.length ? "" : "ok");
  } catch (e) {
    banner(e instanceof LoadError ? e.message : `불러오지 못했습니다: ${e.message}`, "err");
  }
}

function banner(text, kind = "") {
  const el = document.createElement("div");
  el.className = `notice ${kind}`;
  el.textContent = text;
  const pane = $("#pane");
  pane.insertBefore(el, pane.firstChild);
  setTimeout(() => el.remove(), 8000);
}

/** Re-sync every on-screen input after the state is replaced wholesale. */
function reloadInputsFromState() {
  for (const [sid, tr] of ROWS) {
    const a = stu(sid);
    for (const el of tr.querySelectorAll("[data-k]")) {
      const i = SLOT_INDEX[el.dataset.k];
      if (el.type === "checkbox") el.checked = !!a[i];
      else el.value = a[i] || "";
    }
    tr.classList.toggle("off", !a[SLOT_INDEX.own]);
  }
}

/* ---------------- bootstrap ---------------- */

function switchView(name) {
  for (const b of document.querySelectorAll(".tab")) {
    b.setAttribute("aria-selected", String(b.dataset.view === name));
  }
  $("#view-students").classList.toggle("hidden", name !== "students");
  $("#view-inventory").classList.toggle("hidden", name !== "inventory");
}

async function init() {
  try {
    GAME = await loadGame();
  } catch (e) {
    $("#loading").innerHTML = `<div class="notice err"><b>데이터를 불러오지 못했습니다</b>${esc(e.message)}<br><br>
      file:// 로 직접 열면 브라우저가 막습니다. <code>npm run dev</code> 로 로컬 서버를 띄우고 여세요.</div>`;
    return;
  }
  IDX = buildIndex(GAME);
  STATE = loadState();
  PENDING = createPending(IDX, (sid) => toObj(stu(sid)));

  const t0 = performance.now();
  buildTable();
  const built = Math.round(performance.now() - t0);

  FILTERS = createFilters(GAME, (sid) => stu(sid)[SLOT_INDEX.curStar] || 0);
  $("#filterwrap").innerHTML = renderFilterBar(FILTERS);
  $("#filterwrap").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.clear) FILTERS.clear();
    else if (b.dataset.fk) FILTERS.toggle(b.dataset.fk, b.dataset.fv);
    else return;
    $("#filterwrap").innerHTML = renderFilterBar(FILTERS);
    applyFilter();
  });
  $("#btn-filters").onclick = () => {
    const w = $("#filterwrap");
    w.classList.toggle("hidden");
    $("#btn-filters").setAttribute("aria-pressed", String(!w.classList.contains("hidden")));
  };

  $("#presets").innerHTML = SKILL_PRESETS
    .map((p, i) => `<button data-preset="${i}">${p.label}</button>`).join("");
  $("#presets").onclick = (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) applyPreset(["tgtEx", "tgtNormal", "tgtPass", "tgtSub"], SKILL_PRESETS[+b.dataset.preset].v);
  };
  $("#gearpresets").innerHTML = GEAR_PRESETS
    .map((p, i) => `<button data-gp="${i}">${p.label}</button>`).join("");
  $("#gearpresets").onclick = (e) => {
    const b = e.target.closest("[data-gp]");
    if (b) {
      const v = GEAR_PRESETS[+b.dataset.gp].v;
      applyPreset(["tgtGear1", "tgtGear2", "tgtGear3"], [v, v, v]);
    }
  };

  $("#colgroups").onclick = (e) => {
    const b = e.target.closest("[data-col]");
    if (!b) return;
    COLS[b.dataset.col] = !COLS[b.dataset.col];
    applyColumns();
  };
  applyColumns();
  wirePendingBar();

  renderInventory();
  refresh();
  applyFilter();

  $("#loading").classList.add("hidden");
  $("#view-students").classList.remove("hidden");
  $("#ver").textContent = `학생 ${GAME.students.length} · ${built}ms`;

  for (const b of document.querySelectorAll(".tab")) b.onclick = () => switchView(b.dataset.view);
  for (const id of ["#q", "#only-own", "#only-need"]) $(id).oninput = applyFilter;
  $("#btn-export").onclick = doExport;
  $("#btn-import").onclick = () => $("#file-input").click();
  $("#file-input").onchange = (e) => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ""; };
}

init();
