import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, firefox, webkit } = require('../browsers/node_modules/playwright');

const WL_SRC = readFileSync(new URL('./workload.js', import.meta.url), 'utf8');
const BUNDLE = v => readFileSync(`./node_modules/bson-${v}/lib/bson.bundle.js`, 'utf8');
const N = 60_000;

const TARGETS = [
  ['chromium', chromium, ['--js-flags=--expose-gc', '--enable-precise-memory-info']],
  ['firefox',  firefox,  []],
  ['webkit',   webkit,   []],
];

async function freshPage(type, args, wantCdp) {
  const b = await type.launch({ args });
  const page = await b.newPage();
  const cdp = wantCdp ? await page.context().newCDPSession(page) : null;
  await page.evaluate(src => { new Function(src)(); }, WL_SRC);
  for (const v of ['before', 'after'])
    await page.evaluate(([tag, src]) => { globalThis['B_' + tag] = new Function(src + '\n;return BSON;')(); },
                        [v, BUNDLE(v)]);
  return { b, page, cdp };
}

for (const [name, type, args] of TARGETS) {
  const memCtx = await freshPage(type, args, name === 'chromium');
  const b = memCtx.b, page = memCtx.page, cdp = memCtx.cdp;

  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage');
                             return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
  const store = await page.evaluate(() => new B_before.ObjectId().buffer.constructor.name);
  console.log(`\n===== ${name} ${b.version()} =====`);
  console.log(`  storage: ObjectId.buffer is ${store}` +
              `   memory: ${cdp ? 'CDP Runtime.getHeapUsage (exact)' : 'NOT MEASURABLE — no heap API'}`);
  console.log('  version          doc(1)  doc(3)   B/ObjectId    deser      ser   round trip');
  const rows = [];
  for (const [label, tag] of [['before (7.3.1)', 'before'], ['after  (7.3.2)', 'after']]) {
    let doc1 = NaN, doc3 = NaN, perOid = NaN;
    if (cdp) {                                   // stepwise so CDP can collect between steps
      const perDoc = async n => {
        await page.evaluate(([tag, n, N]) => WL.memSetup(globalThis['B_' + tag], n, N), [tag, n, N]);
        const b0 = await heap();
        await page.evaluate(N => WL.memFill(N), N);
        const b1 = await heap();
        await page.evaluate(() => WL.memRelease());
        await heap();
        return (b1 - b0) / N;
      };
      doc1 = await perDoc(1); doc3 = await perDoc(3); perOid = (doc3 - doc1) / 2;
    }
    const rt = await freshPage(type, args, false);        // one process per version:
    const t = await rt.page.evaluate(([tag, N]) =>        // keeps the call site monomorphic
      WL.roundTripPerObjectId(globalThis['B_' + tag], () => performance.now() * 1e6, N), [tag, N]);
    await rt.b.close();
    rows.push({ label, doc1, doc3, perObjectId: perOid, ...t });
    const f = (x, w) => (Number.isFinite(x) ? x.toFixed(0) : '  --').padStart(w);
    console.log(`  ${label}  ${f(doc1,6)}  ${f(doc3,6)}  ${(Number.isFinite(perOid)?perOid.toFixed(1):'--').padStart(9)} B` +
                `  ${f(t.deserialize,7)}  ${f(t.serialize,7)}  ${f(t.roundTrip,8)} ns`);
  }
  if (process.env.MACHINE) console.log('MACHINE ' + name + ' ' + JSON.stringify(rows.map(r => ({
    label: r.label.trim(), mem: r.perObjectId, des: r.deserialize, ser: r.serialize, rt: r.roundTrip }))));
  const [x, y] = rows;
  if (Number.isFinite(x.perObjectId))
    console.log(`\n  memory  ${x.perObjectId.toFixed(0)} B -> ${y.perObjectId.toFixed(0)} B   ${((1-y.perObjectId/x.perObjectId)*100).toFixed(0)}% less`);
  console.log(`  speed   ${(x.roundTrip/y.roundTrip).toFixed(2)}x the round trip of 7.3.1`);
  await b.close();
}
