import { readFileSync } from 'node:fs';
new Function(readFileSync(new URL('./workload.js', import.meta.url), 'utf8'))();
const RT = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node';
let gc, heap, ver;
if (RT === 'bun') { const jsc = await import('bun:jsc');
  gc = () => { for (let i=0;i<8;i++) Bun.gc(true); }; heap = () => jsc.heapStats().heapSize;
  ver = `bun ${Bun.version} (JavaScriptCore)`; }
else if (RT === 'deno') {
  gc = () => { for (let i=0;i<8;i++) globalThis.gc(); };
  heap = () => { const m = Deno.memoryUsage(); return m.heapUsed + m.external; };
  ver = `deno ${Deno.version.deno} (V8 ${Deno.version.v8})`; }
else { gc = () => { for (let i=0;i<8;i++) globalThis.gc(); };
  heap = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
  ver = `node ${process.version} (V8 ${process.versions.v8})`; }
if (typeof globalThis.gc !== 'function' && RT !== 'bun') { console.error('need an exposed gc'); process.exit(1); }
// bson probes for V8 startup snapshots; Bun's node:v8 shim throws on that call.
// Neutralising just that lookup leaves every other code path untouched.
if (RT === 'bun' && globalThis.process?.getBuiltinModule) {
  const orig = process.getBuiltinModule.bind(process);
  process.getBuiltinModule = n => (n === 'v8' ? {} : orig(n));
}
const now = () => performance.now() * 1e6;                       // ns
const ONLY = process.argv[2];                      // 'before' | 'after' | undefined
const rows = [];
for (const [label, pkg] of [['before (7.3.1)', 'bson-before'], ['after  (7.3.2)', 'bson-after']]) {
  if (ONLY && !label.startsWith(ONLY)) continue;
  const BSON = await import(pkg);
  if (label.startsWith('before')) console.log(`  storage: ObjectId.buffer is ${new BSON.ObjectId().buffer.constructor.name}` +
    (typeof Buffer !== 'undefined' && Buffer.poolSize ? `, Buffer.poolSize ${Buffer.poolSize}` : ', no Buffer pooling'));
  const m = WL.perObjectId(BSON, gc, heap);
  const t = WL.roundTripPerObjectId(BSON, now);
  rows.push({ label, mem1: m.doc1, mem3: m.doc3, perObjectId: m.perObjectId, ...t });
}
console.log(`\n===== ${ver} =====`);
console.log('  version          doc(1)  doc(3)   B/ObjectId    deser      ser   round trip');
for (const r of rows)
  console.log(`  ${r.label}  ${r.mem1.toFixed(0).padStart(6)}  ${r.mem3.toFixed(0).padStart(6)}` +
              `  ${r.perObjectId.toFixed(1).padStart(9)} B  ${(r.deserialize).toFixed(0).padStart(7)}  ` +
              `${(r.serialize).toFixed(0).padStart(7)}  ${(r.roundTrip).toFixed(0).padStart(8)} ns`);
if (rows.length === 2) {
  const [b, a] = rows;
  console.log(`\n  memory  ${b.perObjectId.toFixed(0)} B -> ${a.perObjectId.toFixed(0)} B   ${((1-a.perObjectId/b.perObjectId)*100).toFixed(0)}% less`);
  console.log(`  speed   ${(b.roundTrip/a.roundTrip).toFixed(2)}x the round trip of 7.3.1\n`);
}
if (process.env.MACHINE) console.log('MACHINE ' + JSON.stringify(rows.map(r => ({
  label: r.label.trim(), mem: r.perObjectId, des: r.deserialize, ser: r.serialize, rt: r.roundTrip }))));
