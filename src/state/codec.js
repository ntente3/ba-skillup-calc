/**
 * State serialization.
 *
 * There is no server; people move files and strings by hand. Three things follow from
 * that, and this module exists to survive them:
 *
 *   - strings get truncated (messenger limits, partial copies)  -> detected by CRC
 *   - whitespace and line breaks get inserted (auto-wrapping)   -> stripped before decode
 *   - a months-old string shows up (older schema)               -> versioned migration
 *
 * The single goal is to never fail quietly. A half-successful import costs someone hours
 * of typed input.
 */

import { SCHEMA_VERSION, MAGIC, SLOTS, clampStudent, isEmptyStudent } from "./schema.js";

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- base64url ---------- */
function toB64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") {
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/* ---------- 압축 (환경에 따라 주입) ---------- */
let deflate = null;
let inflate = null;

/** Browsers pass CompressionStream; Node passes zlib. */
export function configureCompression({ deflateRaw, inflateRaw }) {
  deflate = deflateRaw;
  inflate = inflateRaw;
}

/* ---------- 정규화 ---------- */

/**
 * Normalize before writing. Students left at defaults are dropped entirely — there is no
 * reason to serialize 200 unowned students as zeroes.
 */
export function normalize(state) {
  const students = {};
  for (const [sid, arr] of Object.entries(state.students || {})) {
    const clean = clampStudent(arr);
    if (!isEmptyStudent(clean)) students[sid] = trimTrailingZeros(clean);
  }
  const inv = {};
  for (const [k, v] of Object.entries(state.inv || {})) {
    const n = Math.max(0, Math.trunc(Number(v) || 0));
    if (n) inv[k] = n;
  }
  const schools = {};
  for (const [k, v] of Object.entries(state.schools || {})) {
    if (!v) schools[k] = 0;      // default is "included", so only record exclusions
  }
  return { v: SCHEMA_VERSION, students, inv, schools };
}

function trimTrailingZeros(arr) {
  let end = arr.length;
  while (end > 0 && !arr[end - 1]) end--;
  return arr.slice(0, end);
}

/** Pad short arrays with zeroes — this is how a newer build reads an older export. */
export function padStudent(arr) {
  const out = new Array(SLOTS.length).fill(0);
  for (let i = 0; i < Math.min(arr.length, SLOTS.length); i++) out[i] = arr[i] || 0;
  return out;
}

/* ---------- 인코딩 ---------- */

/**
 * Compact string for sharing. Format: BA1.<payload>.<crc>
 * The prefix carries both the app and the schema version, so a pasted string identifies
 * itself immediately.
 */
export async function encodeString(state) {
  const json = JSON.stringify(normalize(state));
  const raw = new TextEncoder().encode(json);
  const packed = await deflate(raw);
  const crc = crc32(raw).toString(36);
  return `${MAGIC}${SCHEMA_VERSION}.${toB64Url(packed)}.${crc}`;
}

export async function decodeString(text) {
  const cleaned = String(text).replace(/\s+/g, "");
  const m = cleaned.match(/^([A-Z]+)(\d+)\.([A-Za-z0-9_-]+)\.([a-z0-9]+)$/);
  if (!m) {
    throw new LoadError("코드 형식이 아닙니다 — 일부가 빠졌을 수 있습니다.");
  }
  const [, magic, ver, payload, crcStr] = m;
  if (magic !== MAGIC) throw new LoadError(`이 앱의 코드가 아닙니다 (${magic}).`);

  // Check the version before decompressing. A future version's payload is *supposed* to
  // be unreadable here; reporting it as "corrupted" sends people looking in the wrong place.
  if (Number(ver) > SCHEMA_VERSION) {
    throw new LoadError(`더 최신 버전의 데이터입니다 (v${ver}). 앱을 업데이트하세요.`);
  }

  let raw;
  try {
    raw = await inflate(fromB64Url(payload));
  } catch {
    throw new LoadError("코드가 손상되었습니다. 전체가 복사되었는지 확인하세요.");
  }
  if (crc32(raw).toString(36) !== crcStr) {
    throw new LoadError("코드가 잘렸습니다. 길이 제한이 없는 곳에서 다시 복사하세요.");
  }
  return migrate(JSON.parse(new TextDecoder().decode(raw)), Number(ver));
}

/** File export. Left uncompressed so a person can open and read it. */
export function encodeFile(state) {
  return JSON.stringify({ ...normalize(state), app: "ba-skillup", exportedAt: new Date().toISOString() }, null, 1);
}

export function decodeFile(text) {
  const obj = JSON.parse(text);
  return migrate(obj, Number(obj.v) || 1);
}

export class LoadError extends Error {}

/* ---------- 마이그레이션 ---------- */

/**
 * The v1 loader is kept forever — a two-year-old file must still open. New versions add a
 * step function to MIGRATIONS; existing steps are never edited.
 */
const MIGRATIONS = {
  // e.g. 2: (s) => ({ ...s, v: 2, newField: {} }),
};

export function migrate(state, fromVersion) {
  let s = state;
  let v = fromVersion;
  if (v > SCHEMA_VERSION) {
    throw new LoadError(`더 최신 버전의 데이터입니다 (v${v}). 앱을 업데이트하세요.`);
  }
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v + 1];
    if (!step) throw new LoadError(`v${v} -> v${v + 1} 마이그레이션이 정의되지 않았습니다.`);
    s = step(s);
    v++;
  }
  const students = {};
  for (const [sid, arr] of Object.entries(s.students || {})) {
    students[sid] = padStudent(Array.isArray(arr) ? arr : []);
  }
  return { v: SCHEMA_VERSION, students, inv: s.inv || {}, schools: s.schools || {} };
}
