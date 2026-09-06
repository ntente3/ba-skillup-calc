import { readFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { configureCompression, encodeString, encodeFile, normalize } from "../src/state/codec.js";
configureCompression({
  deflateRaw: async (b) => new Uint8Array(deflateRawSync(Buffer.from(b), { level: 9 })),
  inflateRaw: async (b) => new Uint8Array(inflateRawSync(Buffer.from(b))),
});
const real = JSON.parse(readFileSync(new URL("../data/state_fixture.json", import.meta.url), "utf8"));
const n = normalize(real);
const code = await encodeString(real);
const file = encodeFile(real);
const owned = Object.values(n.students).filter((a) => a[0]).length;
console.log(`students ${Object.keys(n.students).length} (owned ${owned}) / stock entries ${Object.keys(n.inv).length}`);
console.log(`raw JSON        ${JSON.stringify(real).length.toLocaleString()} B`);
console.log(`normalized JSON ${JSON.stringify(n).length.toLocaleString()} B`);
console.log(`file (.json)    ${file.length.toLocaleString()} B`);
console.log(`share string    ${code.length.toLocaleString()} chars`);
console.log("  (anonymous fixture: random values compress worse than real data, so a real save is shorter.)");
console.log(`  Discord 2000-char limit: ${code.length <= 2000 ? "fits" : "exceeded - file export must be the primary path"}`);
