// Every ObjectId representation considered in the talk, measured side by side:
// retained memory per instance, and the round trip (12 bytes -> the
// representation -> 12 bytes again).
//
//   npm i bson@7.3.2
//   node --expose-gc benchmark/candidates.js
//
// Each row is the REAL js-bson ObjectId class with exactly three things swapped:
// the field declarations, setFromBytes and serializeInto. Everything else - the
// BSONValue base, the constructor, the prototype - is byte-identical, so the
// only variable across rows is the representation itself. Two rows check the
// method: `Node Buffer` reproduces shipped bson@7.3.1 and `4 x 24 bits` IS
// shipped bson@7.3.2, and both land on the numbers those versions measure.
//
// That matters because a hand-written class with the same shape as ObjectId
// constructs in 13 ns where the real one takes 36. Module boundaries, constructor
// size and deoptimisation were all ruled out; whatever the cause, measuring
// prototypes instead of the real class inflates every ratio, and inflates the
// cheap representations most.
//
// Four more things this harness has to get right:
//
// 1. Round trips run one representation per child process. A shared benchmark
//    helper goes megamorphic and distorts the cheap candidates.
//
// 2. Deserialised objects go into a bounded ring buffer. They have to escape
//    somewhere - discarded, escape analysis elides the allocation for the packed
//    layouts only. But retaining all of them makes the timing a measurement of
//    garbage collection instead: at 600k live objects a six-field class came out
//    cheaper than a five-field one.
//
// 3. Memory and timing run in separate child processes.
//
// 4. Nothing bulk. Buffer.copy costs 28 ns for twelve bytes where twelve writes
//    cost 13, and Buffer.toString('latin1') costs 99 where String.fromCharCode
//    costs 37. At this size the call overhead is the measurement.
//
// The source bytes are shaped like a real ObjectId: a four-byte big-endian unix
// timestamp, then eight random bytes. That matters only for `3 x 32`, whose two
// random groups may or may not stay in V8's small-integer representation.

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let BSON_SRC;
try { BSON_SRC = require.resolve('bson'); }            // the CommonJS build, lib/bson.cjs
catch { console.error('needs bson@7.3.2:  npm i bson@7.3.2'); process.exit(1); }
const SRC = readFileSync(BSON_SRC, 'utf8');

const FIELDS = '    i0;\n    i1;\n    i2;\n    i3;\n';
const SET = `    setFromBytes(b, offset = 0) {
        this.i0 = (b[offset] << 16) | (b[offset + 1] << 8) | b[offset + 2];
        this.i1 = (b[offset + 3] << 16) | (b[offset + 4] << 8) | b[offset + 5];
        this.i2 = (b[offset + 6] << 16) | (b[offset + 7] << 8) | b[offset + 8];
        this.i3 = (b[offset + 9] << 16) | (b[offset + 10] << 8) | b[offset + 11];
    }\n`;
const SER = `    serializeInto(uint8array, index) {
        uint8array[index] = (this.i0 >>> 16) & 0xff;
        uint8array[index + 1] = (this.i0 >>> 8) & 0xff;
        uint8array[index + 2] = this.i0 & 0xff;
        uint8array[index + 3] = (this.i1 >>> 16) & 0xff;
        uint8array[index + 4] = (this.i1 >>> 8) & 0xff;
        uint8array[index + 5] = this.i1 & 0xff;
        uint8array[index + 6] = (this.i2 >>> 16) & 0xff;
        uint8array[index + 7] = (this.i2 >>> 8) & 0xff;
        uint8array[index + 8] = this.i2 & 0xff;
        uint8array[index + 9] = (this.i3 >>> 16) & 0xff;
        uint8array[index + 10] = (this.i3 >>> 8) & 0xff;
        uint8array[index + 11] = this.i3 & 0xff;
        return 12;
    }\n`;
for (const [what, txt] of [['fields', FIELDS], ['setFromBytes', SET], ['serializeInto', SER]])
  if (!SRC.includes(txt)) { console.error('bson source does not match; expected ' + what + ' of 7.3.2'); process.exit(1); }

const w = body => `    setFromBytes(b, offset = 0) {\n${body}\n    }\n`;
const s_ = body => `    serializeInto(uint8array, index) {\n${body}\n        return 12;\n    }\n`;
const twelve = get => Array.from({ length: 12 }, (_, k) => `        uint8array[index + ${k}] = ${get(k)};`).join('\n');

const VARIANTS = {
  'Node Buffer': { fields: '    buffer;\n',
    set: w(`        this.buffer = Buffer.allocUnsafe(12);
        for (let k = 0; k < 12; k++) this.buffer[k] = b[offset + k];`),
    ser: s_(`        const s = this.buffer;\n${twelve(k => `s[${k}]`)}`) },

  'Shared pool': { fields: '    pool;\n    offset;\n', pool: true,
    set: w(`        const c = globalThis.__POOL_CURSOR;
        for (let k = 0; k < 12; k++) globalThis.__POOL[c + k] = b[offset + k];
        this.pool = globalThis.__POOL; this.offset = c;
        globalThis.__POOL_CURSOR = c + 12;`),
    ser: s_(`        const p = this.pool, o = this.offset;\n${twelve(k => `p[o + ${k}]`)}`) },

  'Array': { fields: '    bytes;\n',
    set: w(`        const a = new Array(12);
        for (let k = 0; k < 12; k++) a[k] = b[offset + k];
        this.bytes = a;`),
    ser: s_(`        const a = this.bytes;\n${twelve(k => `a[${k}]`)}`) },

  // Node's latin1 path is a memcpy under the hood, and it beats every readable
  // alternative: spreading a subarray into String.fromCharCode costs 397 ns
  // against 68 for toString, and .apply ties it. Twelve explicit arguments do
  // win, at 24 ns, but only because twelve is fixed and known when the code is
  // written - that is a trick, not an implementation, so this row measures the
  // line a library would actually ship.
  'Binary string': { fields: '    value;\n',
    set: w(`        this.value = b.toString('latin1', offset, offset + 12);`),
    ser: s_(`        uint8array.write(this.value, index, 12, 'latin1');`) },

  'BigInt': { fields: '    value;\n',
    set: w(`        let d = globalThis.__DV;
        if (d === undefined || d.buffer !== b.buffer) d = globalThis.__DV = new DataView(b.buffer, b.byteOffset);
        this.value = (BigInt(d.getUint32(offset)) << 64n) | d.getBigUint64(offset + 4);`),
    ser: s_(`        let d = globalThis.__DVO;
        if (d === undefined || d.buffer !== uint8array.buffer) d = globalThis.__DVO = new DataView(uint8array.buffer, uint8array.byteOffset);
        d.setUint32(index, Number(this.value >> 64n));
        d.setBigUint64(index + 4, BigInt.asUintN(64, this.value));`) },

  '2 x 48 bits': { fields: '    i0;\n    i1;\n',
    set: w(`        this.i0 = b[offset] * 2**40 + b[offset+1] * 2**32 + b[offset+2] * 2**24 +
                  b[offset+3] * 2**16 + b[offset+4] * 2**8 + b[offset+5];
        this.i1 = b[offset+6] * 2**40 + b[offset+7] * 2**32 + b[offset+8] * 2**24 +
                  b[offset+9] * 2**16 + b[offset+10] * 2**8 + b[offset+11];`),
    ser: s_(`        let h = Math.floor(this.i0 / 4294967296), l = this.i0 - h * 4294967296;
        uint8array[index] = (h >>> 8) & 0xff; uint8array[index+1] = h & 0xff;
        uint8array[index+2] = (l >>> 24) & 0xff; uint8array[index+3] = (l >>> 16) & 0xff;
        uint8array[index+4] = (l >>> 8) & 0xff; uint8array[index+5] = l & 0xff;
        h = Math.floor(this.i1 / 4294967296); l = this.i1 - h * 4294967296;
        uint8array[index+6] = (h >>> 8) & 0xff; uint8array[index+7] = h & 0xff;
        uint8array[index+8] = (l >>> 24) & 0xff; uint8array[index+9] = (l >>> 16) & 0xff;
        uint8array[index+10] = (l >>> 8) & 0xff; uint8array[index+11] = l & 0xff;`) },

  '3 x 32 bits': { fields: '    i0;\n    i1;\n    i2;\n',
    set: w(`        this.i0 = b[offset] * 2**24 + b[offset+1] * 2**16 + b[offset+2] * 2**8 + b[offset+3];
        this.i1 = b[offset+4] * 2**24 + b[offset+5] * 2**16 + b[offset+6] * 2**8 + b[offset+7];
        this.i2 = b[offset+8] * 2**24 + b[offset+9] * 2**16 + b[offset+10] * 2**8 + b[offset+11];`),
    ser: s_(`        uint8array[index] = (this.i0 / 16777216) & 0xff; uint8array[index+1] = (this.i0 >>> 16) & 0xff;
        uint8array[index+2] = (this.i0 >>> 8) & 0xff; uint8array[index+3] = this.i0 & 0xff;
        uint8array[index+4] = (this.i1 / 16777216) & 0xff; uint8array[index+5] = (this.i1 >>> 16) & 0xff;
        uint8array[index+6] = (this.i1 >>> 8) & 0xff; uint8array[index+7] = this.i1 & 0xff;
        uint8array[index+8] = (this.i2 / 16777216) & 0xff; uint8array[index+9] = (this.i2 >>> 16) & 0xff;
        uint8array[index+10] = (this.i2 >>> 8) & 0xff; uint8array[index+11] = this.i2 & 0xff;`) },

  '4 x 24 bits': { fields: FIELDS, set: SET, ser: SER },      // the shipped class, untouched
};

// One generated build per representation, written to a temp directory.
const DIR = process.env.CANDIDATES_DIR || mkdtempSync(join(tmpdir(), 'bson-candidates-'));
if (process.env.CANDIDATES_DIR) mkdirSync(DIR, { recursive: true });
const fileFor = name => join(DIR, name.replace(/[^a-z0-9]+/gi, '_') + '.cjs');
function generate() {
  for (const [name, v] of Object.entries(VARIANTS))
    writeFileSync(fileFor(name), SRC.replace(FIELDS, v.fields).replace(SET, v.set).replace(SER, v.ser));
}

// `fill` forces how many of the three 4-byte groups exceed 2**31, to show the best
// and worst case of the `3 x 32` layout. Group 0 is the timestamp, so it only
// crosses 2**31 after January 2038 and is left alone below 3.
const ROWS = [
  ['Node Buffer',    'Node Buffer'],
  ['Shared pool',    'Shared pool'],
  ['Array',          'Array'],
  ['Binary string',  'Binary string'],
  ['BigInt',         'BigInt'],
  ['2 x 48 bits',    '2 x 48 bits'],
  ['3 x 32 bits',    '3 x 32 bits'],
  ['3 x 32 [best]',  '3 x 32 bits', '0'],
  ['3 x 32 [worst]', '3 x 32 bits', '2'],
  ['4 x 24 bits',    '4 x 24 bits'],
];

const [childFile, phase, fill] = process.argv.slice(2);

if (childFile) {                                   // child: ONE representation, ONE phase
  const TS = 1788718889;
  const rnd = x => { x = Math.imul(x ^ 0x9e3779b9, 2654435761); return (x ^ (x >>> 15)) >>> 0; };
  const WIRE = Buffer.alloc(64 * 12);
  for (let k = 0; k < 64; k++) {
    const p = k * 12;
    WIRE.writeUInt32BE(fill === '3' ? (TS | 0x80000000) >>> 0 : TS + k * 37, p);
    for (const [g, o] of [[1, 4], [2, 8]]) {
      const v = rnd(k * 3 + g);
      WIRE.writeUInt32BE(fill === undefined ? v : (g <= +fill ? (v | 0x80000000) : (v & 0x7fffffff)) >>> 0, p + o);
    }
  }
  const OUT = Buffer.alloc(12);
  const at = i => (i & 63) * 12;
  const isPool = childFile.includes('Shared');
  // the pool is allocated inside the measured window, otherwise its twelve bytes
  // per instance fall outside the delta and the row reads 40 B
  const resetPool = n => { globalThis.__POOL = new Uint8Array(n * 12); globalThis.__POOL_CURSOR = 0; };
  if (isPool) resetPool(1000);
  const { ObjectId } = require(childFile);
  const mk = i => new ObjectId(WIRE, at(i));

  OUT.fill(0); mk(0).serializeInto(OUT, 0);
  if (OUT.toString('hex') !== WIRE.toString('hex', 0, 12))
    throw new Error('round trip does not reproduce the bytes');

  const collect = () => { for (let i = 0; i < 6; i++) globalThis.gc(); };
  if (phase === 'mem') {
    if (isPool) resetPool(20_000);
    for (let i = 0; i < 20_000; i++) mk(i);
    const N = 500_000, keep = new Array(N).fill(null);
    collect(); const b = process.memoryUsage(); const before = b.heapUsed + b.arrayBuffers;
    if (isPool) resetPool(N);                      // counted inside the window
    for (let i = 0; i < N; i++) keep[i] = mk(i);
    collect(); const a = process.memoryUsage(); const after = a.heapUsed + a.arrayBuffers;
    if (keep[N - 1] === null) throw new Error('not retained');
    process.send({ mem: (after - before) / N });
  } else {
    const N = 2_000_000, RING = 4096, ring = new Array(RING).fill(null);
    if (isPool) resetPool(N + 64);
    const des = () => { for (let i = 0; i < N; i++) ring[i & (RING - 1)] = mk(i); return ring[0]; };
    const pool = []; for (let i = 0; i < 64; i++) pool.push(mk(i));
    const ser = () => { for (let i = 0; i < N; i++) pool[i & 63].serializeInto(OUT, 0); return pool[0]; };
    for (let w = 0; w < 6; w++) { des(); ser(); }
    const now = () => Number(process.hrtime.bigint());
    const D = [], S = [];
    for (let r = 0; r < 5; r++) {
      collect();
      let t = now(); if (des() === undefined) throw new Error('elided'); D.push((now() - t) / N);
      t = now(); ser(); S.push((now() - t) / N);
    }
    const med = x => x.slice().sort((p, q) => p - q)[2];
    process.send({ des: med(D), ser: med(S), rt: med(D) + med(S) });
  }
} else {
  if (typeof globalThis.gc !== 'function') { console.error('run with --expose-gc'); process.exit(1); }
  generate();
  const self = fileURLToPath(import.meta.url);
  const out = [];
  for (const [label, variant, f] of ROWS) {
    const row = { label };
    for (const p of ['mem', 'rt']) {
      const args = [fileFor(variant), p]; if (f !== undefined) args.push(f);
      const child = fork(self, args, { execArgv: ['--expose-gc'], stdio: 'inherit' });
      Object.assign(row, await new Promise((res, rej) => {
        child.on('message', res);
        child.on('exit', c => c && rej(new Error(`${label} ${p} exited ${c}`)));
      }));
    }
    out.push(row);
  }
  const base = out.find(r => r.label === 'Node Buffer').rt;
  console.log(`\nnode ${process.version}  ·  pointer compression: ${process.config.variables.v8_enable_pointer_compression ? 'on' : 'off'}`);
  console.log('each row is the real bson ObjectId class with only the representation swapped\n');
  console.log('  representation        MEMORY   ROUND TRIP        ns');
  console.log('  ' + '-'.repeat(52));
  for (const r of out)
    console.log(`  ${r.label.padEnd(18)} ${r.mem.toFixed(0).padStart(6)} B  ${(base / r.rt).toFixed(2).padStart(8)}x  ${r.rt.toFixed(1).padStart(7)}`);
  console.log('\n  round trip is relative to the Node Buffer baseline; higher is faster\n');
}
