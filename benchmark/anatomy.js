// Decomposes the per-object byte costs behind the benchmark results on the
// current Node.js version, using two independent methods:
//
//   1. Delta isolation: retain one million values that differ by exactly one
//      component; the post-GC heapUsed + arrayBuffers deltas isolate each
//      component's cost.
//   2. V8 heap snapshot: read the engine's own self_size for each object kind.
//
//   node --expose-gc benchmark/anatomy.js
//
// Sizes are specific to the Node.js and V8 build; run under each version to
// compare.

import v8 from 'node:v8';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as before from 'bson-before';
import * as after from 'bson-after';

if (typeof globalThis.gc !== 'function') {
  console.error('This script must run with --expose-gc');
  process.exit(1);
}

const COUNT = 1_000_000;
const HEX = '507f191e810c19729de860ea';

function collectGarbage() {
  for (let cycle = 0; cycle < 5; cycle += 1) {
    globalThis.gc();
  }
}

function liveMemory() {
  const usage = process.memoryUsage();
  return { heap: usage.heapUsed, arrayBuffers: usage.arrayBuffers };
}

function measure(make) {
  let sink = null;
  for (let index = 0; index < 20_000; index += 1) {
    sink = make(index);
  }
  if (sink === undefined) {
    throw new Error('unreachable');
  }

  const retained = new Array(COUNT).fill(null);
  collectGarbage();
  const baseline = liveMemory();

  for (let index = 0; index < COUNT; index += 1) {
    retained[index] = make(index);
  }

  collectGarbage();
  const current = liveMemory();

  if (retained[COUNT - 1] === null) {
    throw new Error('values were not retained');
  }

  const result = {
    heap: (current.heap - baseline.heap) / COUNT,
    arrayBuffers: (current.arrayBuffers - baseline.arrayBuffers) / COUNT
  };
  result.total = result.heap + result.arrayBuffers;

  retained.length = 0;
  collectGarbage();
  return result;
}

const sharedBuffer = new ArrayBuffer(COUNT * 16 + 4096);

const cases = [
  ['view over a shared buffer (view object alone)', index => new Uint8Array(sharedBuffer, index * 16, 12)],
  ['new ArrayBuffer(0) (ArrayBuffer object alone)', () => new ArrayBuffer(0)],
  ['new Uint8Array(12) (standalone total)', () => new Uint8Array(12)],
  ['Buffer.allocUnsafe(12) (pooled buffer)', () => Buffer.allocUnsafe(12)],
  ['bson@7.3.1 new ObjectId()', () => new before.ObjectId()],
  ['bson@7.3.1 new ObjectId(uint8Array)', index => {
    const bytes = new Uint8Array(12);
    bytes[11] = index & 0xff;
    return new before.ObjectId(bytes);
  }],
  ['bson@7.3.2 new ObjectId()', () => new after.ObjectId()],
  ['bson@7.3.2 new ObjectId(hex)', () => new after.ObjectId(HEX)]
];

console.log(`Node.js ${process.versions.node} (V8 ${process.versions.v8}), ${process.platform}-${process.arch}`);
console.log(`${COUNT.toLocaleString('en-US')} retained instances per row, post-GC deltas\n`);
console.log('Method 1: delta isolation\n');
console.log('| Case | JS heap | arrayBuffers | Total |');
console.log('| --- | ---: | ---: | ---: |');

const results = {};
for (const [label, make] of cases) {
  const result = measure(make);
  results[label] = result;
  console.log(
    `| ${label} | ${result.heap.toFixed(1)} B | ` +
    `${result.arrayBuffers.toFixed(1)} B | ${result.total.toFixed(1)} B |`
  );
}

const view = results['view over a shared buffer (view object alone)'].total;
const arrayBufferObject = results['new ArrayBuffer(0) (ArrayBuffer object alone)'].total;
const standalone = results['new Uint8Array(12) (standalone total)'].total;
const pooled = results['Buffer.allocUnsafe(12) (pooled buffer)'].total;
const oldObjectId = results['bson@7.3.1 new ObjectId()'].total;
const newObjectId = results['bson@7.3.2 new ObjectId()'].total;

console.log('\nDerived decomposition\n');
console.log(`new Uint8Array(12) = ${standalone.toFixed(0)} B`);
console.log(`  view object          ${view.toFixed(0)} B`);
console.log(`  ArrayBuffer object   ${arrayBufferObject.toFixed(0)} B`);
console.log(`  on-heap store        ${(standalone - view - arrayBufferObject).toFixed(0)} B (12 payload bytes plus store header, aligned)`);
console.log(`Buffer.allocUnsafe(12) = ${pooled.toFixed(0)} B`);
console.log(`  view object          ${view.toFixed(0)} B`);
console.log(`  slice of the pool    ${(pooled - view).toFixed(0)} B (12 bytes rounded to 8-byte alignment)`);
console.log(`bson@7.3.1 ObjectId = ${oldObjectId.toFixed(0)} B`);
console.log(`  wrapper object       ${(oldObjectId - pooled).toFixed(0)} B (object header plus one field slot)`);
console.log(`  pooled Buffer        ${pooled.toFixed(0)} B`);
console.log(`bson@7.3.2 ObjectId = ${newObjectId.toFixed(0)} B`);
console.log('  object header        24 B (map, properties, and elements pointers)');
console.log('  four field slots     32 B (8 B each, Smi values stored inline)');

function snapshotSizes(makeLive, wantedKeys) {
  const live = [];
  for (let index = 0; index < 20_000; index += 1) {
    live.push(makeLive(index));
  }

  const file = path.join(tmpdir(), `anatomy-${process.pid}.heapsnapshot`);
  collectGarbage();
  v8.writeHeapSnapshot(file);
  const snapshot = JSON.parse(readFileSync(file, 'utf8'));
  unlinkSync(file);

  const fields = snapshot.snapshot.meta.node_fields;
  const kinds = snapshot.snapshot.meta.node_types[0];
  const stride = fields.length;
  const typeIndex = fields.indexOf('type');
  const nameIndex = fields.indexOf('name');
  const sizeIndex = fields.indexOf('self_size');

  const aggregated = new Map();
  for (let offset = 0; offset < snapshot.nodes.length; offset += stride) {
    const key = `${kinds[snapshot.nodes[offset + typeIndex]]}:${snapshot.strings[snapshot.nodes[offset + nameIndex]]}`;
    const entry = aggregated.get(key) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += snapshot.nodes[offset + sizeIndex];
    aggregated.set(key, entry);
  }

  if (live.length !== 20_000) {
    throw new Error('unreachable');
  }
  live.length = 0;

  return wantedKeys.map(key => {
    const entry = aggregated.get(key);
    return { key, count: entry?.count ?? 0, each: entry ? entry.bytes / entry.count : Number.NaN };
  });
}

console.log('\nMethod 2: V8 heap snapshot self_size (20,000 live objects per pass)\n');

for (const row of snapshotSizes(() => new Uint8Array(12), ['object:Uint8Array', 'object:ArrayBuffer'])) {
  console.log(`${row.key}: shallow ${row.each.toFixed(0)} B (count ${row.count.toLocaleString('en-US')})`);
}
for (const row of snapshotSizes(() => new after.ObjectId(), ['object:ObjectId'])) {
  console.log(`${row.key}: shallow ${row.each.toFixed(0)} B (count ${row.count.toLocaleString('en-US')}) <- packed representation`);
}
