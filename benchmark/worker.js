import { workloads } from './workloads.js';

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }

    options[key.slice(2)] = value;
  }

  return options;
}

async function forceGarbageCollection() {
  if (typeof global.gc !== 'function') {
    throw new Error('This worker must be started with --expose-gc');
  }

  for (let cycle = 0; cycle < 4; cycle += 1) {
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
  }

  global.gc();
}

function captureMemory() {
  const usage = process.memoryUsage();

  return {
    heapUsed: usage.heapUsed,
    arrayBuffers: usage.arrayBuffers,
    liveMemory: usage.heapUsed + usage.arrayBuffers,
    rss: usage.rss
  };
}

const options = parseArguments(process.argv.slice(2));
const implementation = options.implementation;
const workloadName = options.workload;
const count = Number.parseInt(options.count, 10);

if (!['before', 'after'].includes(implementation)) {
  throw new Error(`Unknown implementation: ${implementation}`);
}

if (!Number.isSafeInteger(count) || count <= 0) {
  throw new Error(`Count must be a positive integer, received: ${options.count}`);
}

const workload = workloads[workloadName];

if (!workload) {
  throw new Error(`Unknown workload: ${workloadName}`);
}

const packageName = implementation === 'before' ? 'bson-before' : 'bson-after';
const bson = await import(packageName);
const prepared = workload.prepare?.({ bson });
const target = workload.level === 'per-instance'
  ? new Array(count).fill(null)
  : undefined;

await forceGarbageCollection();
const baseline = captureMemory();

const retained = workload.allocate({ bson, count, prepared, target });
globalThis.__objectIdMemoryBenchmarkRetained = retained;

if (retained.length !== count) {
  throw new Error(`Workload retained ${retained.length} values instead of ${count}`);
}

await forceGarbageCollection();
const after = captureMemory();
const deltaBytes = after.liveMemory - baseline.liveMemory;

process.stdout.write(`${JSON.stringify({
  implementation,
  workload: workloadName,
  count,
  baseline,
  after,
  deltaBytes,
  bytesPerUnit: deltaBytes / count
})}\n`);
