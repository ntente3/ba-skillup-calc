import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  configureCompression, encodeString, decodeString,
  encodeFile, decodeFile, normalize, padStudent, LoadError,
} from "../src/state/codec.js";
import { SLOTS } from "../src/state/schema.js";

configureCompression({
  deflateRaw: async (b) => new Uint8Array(deflateRawSync(Buffer.from(b), { level: 9 })),
  inflateRaw: async (b) => new Uint8Array(inflateRawSync(Buffer.from(b))),
});

const real = JSON.parse(readFileSync(new URL("../data/state_fixture.json", import.meta.url), "utf8"));

test("round-trips real-shaped data with no value changed", async () => {
  const code = await encodeString(real);
  const back = await decodeString(code);
  const before = normalize(real);
  for (const [sid, arr] of Object.entries(before.students)) {
    assert.deepEqual(back.students[sid].slice(0, arr.length), arr, `sid ${sid}`);
  }
  assert.deepEqual(back.inv, before.inv);
});

test("round-trips through the file format", () => {
  const back = decodeFile(encodeFile(real));
  assert.equal(Object.keys(back.students).length, Object.keys(normalize(real).students).length);
});

test("a truncated string does not pass silently", async () => {
  const code = await encodeString(real);
  const truncated = code.slice(0, Math.floor(code.length * 0.8));
  await assert.rejects(() => decodeString(truncated), LoadError);
});

test("CRC catches a single flipped character", async () => {
  const code = await encodeString(real);
  const i = Math.floor(code.length / 2);
  const flipped = code.slice(0, i) + (code[i] === "A" ? "B" : "A") + code.slice(i + 1);
  await assert.rejects(() => decodeString(flipped), LoadError);
});

test("survives whitespace inserted by messengers", async () => {
  const code = await encodeString(real);
  const mangled = code.replace(/(.{60})/g, "$1\n  ");
  const back = await decodeString(mangled);
  assert.equal(Object.keys(back.students).length, Object.keys(normalize(real).students).length);
});

test("rejects a future version and says why", async () => {
  await assert.rejects(
    () => decodeString("BA9.abc.xyz"),
    (e) => e instanceof LoadError && /업데이트/.test(e.message)
  );
});

test("reads a shorter older array by padding with zeroes", () => {
  const back = decodeFile(JSON.stringify({ v: 1, students: { "7": [1, 8, 90] }, inv: {}, schools: {} }));
  assert.equal(back.students["7"].length, SLOTS.length);
  assert.deepEqual(back.students["7"].slice(0, 3), [1, 8, 90]);
});

test("clamps out-of-range values", () => {
  // Consumers see the padded value, so verify through that path.
  const n = normalize({ students: { "1": [1, 999, -5, 0, 0, 0, 0, 0] }, inv: {}, schools: {} });
  const read = padStudent(n.students["1"]);
  assert.equal(read[1], 8, "stars clamp at 8");
  assert.equal(read[2], 0, "negatives become 0");
  assert.equal(read.length, SLOTS.length);
});

test("does not serialize all-default students", () => {
  const n = normalize({ students: { "1": new Array(20).fill(0), "2": [1] }, inv: {}, schools: {} });
  assert.deepEqual(Object.keys(n.students), ["2"]);
});
