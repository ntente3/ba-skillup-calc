import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateGear } from "../src/core/gear-stock.js";
import { createPending } from "../web/pending.js";
import { encodeFile, decodeFile, encodeString, decodeString } from "../src/state/codec.js";
import { configureCompression } from "../src/state/codec.js";
import { deflateRawSync, inflateRawSync } from "node:zlib";

test("gear stock is used first; shared selectors cover shortages once in stable type order", () => {
  const inv = { "eq.0.2": 10, "eq.1.2": 2, "eq-select.2": 8, "eq-select.3": 100 };
  const r = allocateGear({ "eq.1.2": 10, "eq.0.2": 15, "eq.2.4": 7 }, inv);
  assert.deepEqual(r.selected, { "eq.0.2": 5, "eq.1.2": 3 });
  assert.deepEqual(r.selectors, { "eq-select.2": 8 });
  assert.deepEqual(r.debit, { "eq.0.2": 10, "eq.1.2": 7, "eq.2.4": 7 });
  assert.equal(inv["eq-select.2"], 8, "preview does not change inventory");
});

test("unused selectors remain available; missing selectors preserve ordinary consumption", () => {
  assert.deepEqual(allocateGear({ "eq.0.2": 15 }, { "eq.0.2": 20, "eq-select.2": 50 }).selectors, {});
  assert.deepEqual(allocateGear({ "eq.0.2": 15 }, {}).debit, { "eq.0.2": 15 });
  assert.equal(allocateGear({ "eq.0.2": 15 }, { "eq-select.2": 50 }).selectors["eq-select.2"], 15);
});

test("pending consumption pools students, debits selectors, reports shortages and undoes both stocks", () => {
  const states = { 1: { curGear1: 1 }, 2: { curGear1: 1 } };
  const idx = {
    students: new Map([[1, { gear: ["hat"] }], [2, { gear: ["hat"] }]]),
    gearTypeIndex: new Map([["hat", 0]]), gear: { tierLabels: [2] },
  };
  const pending = createPending(idx, (sid) => states[sid]);
  for (const sid of [1, 2]) {
    pending.mark(sid);
    states[sid] = { curGear1: 2 };
  }
  const consume = () => ({ bd: [], note: [], opart: [], gear: [[15]], credit: 1500 });
  const inv = { "eq.0.2": 5, "eq-select.2": 20, "eq-select.3": 7 };
  const before = { ...inv };
  const result = pending.apply(inv, consume);
  assert.deepEqual(inv, { "eq.0.2": -5, "eq-select.2": 0, "eq-select.3": 7 });
  assert.deepEqual(result, { short: [{ key: "eq.0.2", by: 5 }], credit: 3000 });
  assert.equal(pending.count(), 0);
  assert.equal(pending.revert(inv), true);
  assert.deepEqual(inv, before);
});

test("negative gear stock stays recorded while selectors cover newly consumed blueprints", () => {
  const r = allocateGear({ "eq.0.2": 15 }, { "eq.0.2": -5, "eq-select.2": 20 });
  assert.equal(r.selectors["eq-select.2"], 15);
  assert.equal(r.debit["eq.0.2"], 0);
});

test("selector inventory survives file and compressed export; older inventories still load", async () => {
  configureCompression({ deflateRaw: async (b) => deflateRawSync(b), inflateRaw: async (b) => inflateRawSync(b) });
  const state = { students: {}, inv: { "eq-select.2": 12, "eq-select.10": 34 }, schools: {} };
  assert.deepEqual(decodeFile(encodeFile(state)).inv, state.inv);
  assert.deepEqual((await decodeString(await encodeString(state))).inv, state.inv);
  assert.deepEqual(decodeFile('{"v":1,"inv":{"eq.0.2":5}}').inv, { "eq.0.2": 5 });
});
