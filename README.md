# js-bson ObjectId memory benchmark

This repository reproduces the memory measurements for the change that replaced the 12-byte `Buffer` or `Uint8Array`
stored by each js-bson `ObjectId` with four 24-bit integers.

It compares the published BSON versions immediately before and after the change:

- `bson@7.3.1`, using the previous byte-array representation
- `bson@7.3.2`, using four packed integers

The benchmark measures memory only. Operation timings and BSON throughput remain part of the js-bson performance suite.

## Results

The run currently preserved in [`results/`](results/summary.md) (darwin-arm64, Apple M1 Pro, 3 repetitions), before →
after:

| Node.js | `new ObjectId()` | `new ObjectId(uint8Array)` | Document with one `_id` | 1M documents, three ObjectIds each |
|---------|-----------------:|---------------------------:|------------------------:|-----------------------------------:|
| 22      |   144.3 → 56.1 B |             228.0 → 56.0 B |         200.4 → 112.1 B |                  664.7 → 412.1 MiB |
| 24      |   152.1 → 56.1 B |             244.0 → 56.0 B |         208.2 → 112.1 B |                  671.6 → 396.9 MiB |
| 26      |   152.1 → 56.1 B |             244.0 → 56.0 B |         208.2 → 112.1 B |                  671.6 → 396.9 MiB |

Construction from a hex string measures the same as `new ObjectId()` on every version.

## Measurements

The benchmark covers two levels.

### Per instance

- `new ObjectId()`
- `new ObjectId(hex)`
- `new ObjectId(uint8Array)`, with a separate `ArrayBuffer` for every input
- Deserializing a document containing one ObjectId

Each workload creates and retains one million values. The measured memory delta is divided by that count to estimate the
contribution of one ObjectId or document.

### Process-level workload

The larger workload deserializes and retains one million documents. Every document contains three ObjectIds, an integer,
a double, a date, and a short string. This is close to the workload used while reviewing the js-bson implementation.

## Method

Every sample runs in a fresh Node.js process with `--expose-gc` and loads only one BSON version. The worker:

1. Prepares the serialized input when the workload needs one.
2. For a per-instance workload, allocates and initializes the array that will retain the values.
3. Forces garbage collection and records a baseline.
4. Creates or deserializes all values and keeps them reachable.
5. Forces garbage collection again.
6. Records the change in `heapUsed + arrayBuffers`.

Allocating the retention array before the per-instance baseline excludes its eight-byte reference slot from the reported
size of each value. The process-level workload creates its result array after the baseline because that array is part of
the complete retained result set.

The two BSON versions alternate their execution order between repetitions. The reported value is the median of the
independent samples.

This metric is called a **post-GC live-memory delta** in this repository. It is not a universal retained size for an
ObjectId. Exact numbers depend on the Node.js and V8 builds, operating system, architecture, and allocator state. The
useful comparison is between the two BSON versions measured in the same environment.

## Run locally

Install the exact dependencies from the lockfile:

```bash
npm ci
```

Run every workload using the active Node.js version:

```bash
npm run benchmark
```

This writes `results/node-<major>.json` and regenerates `results/summary.md` from all Node.js result files currently in
that directory.

The full benchmark retains several hundred megabytes. To check the installation with one full-size workload and one
sample, run:

```bash
npm run benchmark:run -- \
  --workload objectid-generated \
  --repetitions 1 \
  --output artifacts/smoke.json
```

Change `--workload`, `--repetitions`, and `--output` as needed. Reducing the instance count is not supported because
small samples make the retained-memory result too noisy.

Available workload names are:

- `objectid-generated`
- `objectid-hex`
- `objectid-uint8array`
- `document-one-objectid`
- `documents-three-objectids`

## Node.js matrix

The manual GitHub Actions workflow runs the complete benchmark on Node.js 22, 24, and 26 using `ubuntu-24.04`. Each
version produces a JSON file, and the final job combines them into a Markdown summary.

The workflow does not fail when a particular percentage changes. Memory measurements contain some environmental noise,
and the repository records the samples instead of treating an exact byte count as a compatibility requirement.

After a representative workflow run, download the `memory-results` artifact and copy the three JSON files and generated
`summary.md` into `results/` if you want to preserve that run in the repository.

## Result files

Generated results belong in [`results/`](results/summary.md). The summary contains one table for the per-instance
measurements and another for the one-million-document workload. The JSON files retain all samples and the complete
Node.js, V8, operating-system, architecture, and CPU information.

The original implementation was measured on Node.js 24 and reported substantial reductions both per ObjectId and across
the one-million-document workload. New runs are expected to show the same overall pattern, but they do not need to
reproduce those absolute numbers exactly.

## References

- [Packed ObjectId implementation, js-bson PR #893](https://github.com/mongodb/js-bson/pull/893)
- [String representation proposal, js-bson PR #703](https://github.com/mongodb/js-bson/pull/703)
- [Shared buffer proposal, js-bson PR #707](https://github.com/mongodb/js-bson/pull/707)

## License

MIT. See [LICENSE](LICENSE).
