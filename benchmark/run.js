import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workloadNames, workloads } from './workloads.js';

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.dirname(benchmarkDirectory);
const workerPath = path.join(benchmarkDirectory, 'worker.js');

function parseArguments(argv) {
  const options = {
    repetitions: 3,
    selectedWorkloads: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    const value = argv[index + 1];

    if (value === undefined) {
      throw new Error(`Missing value for ${argument}`);
    }

    if (value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }

    if (argument === '--output') {
      options.output = value;
    } else if (argument === '--repetitions') {
      options.repetitions = Number.parseInt(value, 10);
    } else if (argument === '--workload') {
      options.selectedWorkloads.push(value);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }

    index += 1;
  }

  if (!Number.isSafeInteger(options.repetitions) || options.repetitions <= 0) {
    throw new Error('--repetitions must be a positive integer');
  }

  return options;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function runWorker({ implementation, workload, count }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--expose-gc',
        workerPath,
        '--implementation', implementation,
        '--workload', workload,
        '--count', String(count)
      ],
      {
        cwd: repositoryDirectory,
        env: process.env,
        stdio: ['ignore', 'pipe', 'inherit']
      }
    );

    let output = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(output.trim()));
      } catch (error) {
        reject(new Error(`Could not parse worker output: ${output}`, { cause: error }));
      }
    });
  });
}

function parseAliasVersion(alias) {
  const match = alias.match(/@([^@]+)$/);
  return match?.[1] ?? alias;
}

function formatBytes(value) {
  if (Math.abs(value) >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }

  return `${value.toFixed(1)} B`;
}

const options = parseArguments(process.argv.slice(2));
const packageJson = JSON.parse(
  await readFile(path.join(repositoryDirectory, 'package.json'), 'utf8')
);
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
const outputPath = path.resolve(
  repositoryDirectory,
  options.output ?? `results/node-${nodeMajor}.json`
);
const selectedWorkloads = options.selectedWorkloads.length > 0
  ? options.selectedWorkloads
  : workloadNames;

for (const workloadName of selectedWorkloads) {
  if (!workloads[workloadName]) {
    throw new Error(`Unknown workload: ${workloadName}`);
  }
}

const cases = [];

for (const workloadName of selectedWorkloads) {
  const workload = workloads[workloadName];
  const count = workload.defaultCount;
  const samples = {
    before: [],
    after: []
  };

  process.stderr.write(`\n${workload.label} (${count.toLocaleString()} ${workload.unit}s)\n`);

  for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
    const order = repetition % 2 === 0
      ? ['before', 'after']
      : ['after', 'before'];

    for (const implementation of order) {
      process.stderr.write(
        `  ${implementation}, sample ${repetition + 1}/${options.repetitions}\n`
      );

      samples[implementation].push(
        await runWorker({ implementation, workload: workloadName, count })
      );
    }
  }

  const beforeDelta = median(samples.before.map(sample => sample.deltaBytes));
  const afterDelta = median(samples.after.map(sample => sample.deltaBytes));
  const beforePerUnit = median(samples.before.map(sample => sample.bytesPerUnit));
  const afterPerUnit = median(samples.after.map(sample => sample.bytesPerUnit));

  cases.push({
    name: workloadName,
    label: workload.label,
    level: workload.level,
    unit: workload.unit,
    count,
    samples,
    median: {
      before: {
        deltaBytes: beforeDelta,
        bytesPerUnit: beforePerUnit
      },
      after: {
        deltaBytes: afterDelta,
        bytesPerUnit: afterPerUnit
      },
      reductionPercent: (1 - afterDelta / beforeDelta) * 100
    }
  });
}

const firstCpu = os.cpus()[0];
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  metric: 'post-GC heapUsed + arrayBuffers delta',
  environment: {
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: firstCpu?.model ?? null,
    totalSystemMemoryBytes: os.totalmem(),
    github: process.env.GITHUB_ACTIONS === 'true'
      ? {
          runId: process.env.GITHUB_RUN_ID ?? null,
          sha: process.env.GITHUB_SHA ?? null,
          runnerImage: process.env.ImageOS ?? null
        }
      : null
  },
  packages: {
    before: parseAliasVersion(packageJson.dependencies['bson-before']),
    after: parseAliasVersion(packageJson.dependencies['bson-after'])
  },
  repetitions: options.repetitions,
  cases
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);

process.stdout.write(`\nResults written to ${path.relative(repositoryDirectory, outputPath)}\n\n`);

for (const benchmarkCase of cases) {
  const before = benchmarkCase.level === 'process'
    ? benchmarkCase.median.before.deltaBytes
    : benchmarkCase.median.before.bytesPerUnit;
  const after = benchmarkCase.level === 'process'
    ? benchmarkCase.median.after.deltaBytes
    : benchmarkCase.median.after.bytesPerUnit;

  process.stdout.write(
    `${benchmarkCase.label}: ${formatBytes(before)} -> ${formatBytes(after)} ` +
    `(${benchmarkCase.median.reductionPercent.toFixed(1)}% reduction)\n`
  );
}
