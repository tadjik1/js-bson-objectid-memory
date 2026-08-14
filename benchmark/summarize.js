import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.dirname(benchmarkDirectory);

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }

    if (argument === '--input') {
      options.input = value;
    } else if (argument === '--output') {
      options.output = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function formatBytes(value) {
  return `${value.toFixed(1)} B`;
}

function formatMiB(value) {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatReduction(value) {
  return `${value.toFixed(1)}%`;
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|');
}

const options = parseArguments(process.argv.slice(2));
const inputDirectory = path.resolve(repositoryDirectory, options.input ?? 'results');
const outputPath = path.resolve(
  repositoryDirectory,
  options.output ?? 'results/summary.md'
);
const fileNames = (await readdir(inputDirectory))
  .filter(fileName => /^node-\d+\.json$/.test(fileName))
  .sort((left, right) => {
    const leftMajor = Number.parseInt(left.match(/\d+/)[0], 10);
    const rightMajor = Number.parseInt(right.match(/\d+/)[0], 10);
    return leftMajor - rightMajor;
  });

if (fileNames.length === 0) {
  throw new Error(`No node-*.json files found in ${inputDirectory}`);
}

const results = await Promise.all(
  fileNames.map(async fileName => {
    const contents = await readFile(path.join(inputDirectory, fileName), 'utf8');
    return JSON.parse(contents);
  })
);

const lines = [
  '# Memory benchmark results',
  '',
  'The benchmark reports the median post-GC change in `heapUsed + arrayBuffers`.',
  'Absolute values depend on the runtime build and host. Compare the two BSON versions within the same row.',
  'Per-instance measurements exclude the array used to retain the values. The process-level workload includes its complete result array.',
  '',
  '## Environment',
  '',
  '| Node.js | V8 | Platform | Architecture | Repetitions |',
  '| --- | --- | --- | --- | ---: |'
];

for (const result of results) {
  lines.push(
    `| ${escapeCell(result.environment.node)} | ${escapeCell(result.environment.v8)} | ` +
    `${escapeCell(result.environment.platform)} | ${escapeCell(result.environment.arch)} | ` +
    `${result.repetitions} |`
  );
}

lines.push(
  '',
  '## Per-instance measurements',
  '',
  '| Node.js | Workload | Count | Before | Four integers | Reduction |',
  '| --- | --- | ---: | ---: | ---: | ---: |'
);

for (const result of results) {
  for (const benchmarkCase of result.cases.filter(item => item.level === 'per-instance')) {
    lines.push(
      `| ${escapeCell(result.environment.node)} | ${escapeCell(benchmarkCase.label)} | ` +
      `${benchmarkCase.count.toLocaleString('en-US')} | ` +
      `${formatBytes(benchmarkCase.median.before.bytesPerUnit)} | ` +
      `${formatBytes(benchmarkCase.median.after.bytesPerUnit)} | ` +
      `${formatReduction(benchmarkCase.median.reductionPercent)} |`
    );
  }
}

lines.push(
  '',
  '## Process-level workload',
  '',
  '| Node.js | Workload | Documents | Before | Four integers | Reduction |',
  '| --- | --- | ---: | ---: | ---: | ---: |'
);

for (const result of results) {
  for (const benchmarkCase of result.cases.filter(item => item.level === 'process')) {
    lines.push(
      `| ${escapeCell(result.environment.node)} | ${escapeCell(benchmarkCase.label)} | ` +
      `${benchmarkCase.count.toLocaleString('en-US')} | ` +
      `${formatMiB(benchmarkCase.median.before.deltaBytes)} | ` +
      `${formatMiB(benchmarkCase.median.after.deltaBytes)} | ` +
      `${formatReduction(benchmarkCase.median.reductionPercent)} |`
    );
  }
}

lines.push('');

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join('\n')}\n`);
process.stdout.write(`${path.relative(repositoryDirectory, outputPath)}\n`);
