# Memory benchmark results

The benchmark reports the median post-GC change in `heapUsed + arrayBuffers`.
Absolute values depend on the runtime build and host. Compare the two BSON versions within the same row.
Per-instance measurements exclude the array used to retain the values. The process-level workload includes its complete result array.

## Environment

| Node.js | V8 | Platform | Architecture | Repetitions |
| --- | --- | --- | --- | ---: |
| 22.23.2 | 12.4.254.21-node.56 | darwin | arm64 | 3 |
| 24.19.0 | 13.6.233.17-node.51 | darwin | arm64 | 3 |
| 26.7.0 | 14.6.202.34-node.28 | darwin | arm64 | 3 |

## Per-instance measurements

| Node.js | Workload | Count | Before | Four integers | Reduction |
| --- | --- | ---: | ---: | ---: | ---: |
| 22.23.2 | new ObjectId() | 1,000,000 | 144.3 B | 56.1 B | 61.1% |
| 22.23.2 | new ObjectId(hex) | 1,000,000 | 144.5 B | 56.1 B | 61.2% |
| 22.23.2 | new ObjectId(uint8Array) | 1,000,000 | 228.0 B | 56.0 B | 75.4% |
| 22.23.2 | deserialize document with one ObjectId | 1,000,000 | 200.4 B | 112.1 B | 44.0% |
| 24.19.0 | new ObjectId() | 1,000,000 | 152.1 B | 56.1 B | 63.1% |
| 24.19.0 | new ObjectId(hex) | 1,000,000 | 152.1 B | 56.1 B | 63.1% |
| 24.19.0 | new ObjectId(uint8Array) | 1,000,000 | 244.0 B | 56.0 B | 77.0% |
| 24.19.0 | deserialize document with one ObjectId | 1,000,000 | 208.2 B | 112.1 B | 46.1% |
| 26.7.0 | new ObjectId() | 1,000,000 | 152.1 B | 56.1 B | 63.1% |
| 26.7.0 | new ObjectId(hex) | 1,000,000 | 152.1 B | 56.1 B | 63.1% |
| 26.7.0 | new ObjectId(uint8Array) | 1,000,000 | 244.0 B | 56.0 B | 77.0% |
| 26.7.0 | deserialize document with one ObjectId | 1,000,000 | 208.2 B | 112.1 B | 46.1% |

## Process-level workload

| Node.js | Workload | Documents | Before | Four integers | Reduction |
| --- | --- | ---: | ---: | ---: | ---: |
| 22.23.2 | deserialize documents with three ObjectIds | 1,000,000 | 664.7 MiB | 412.1 MiB | 38.0% |
| 24.19.0 | deserialize documents with three ObjectIds | 1,000,000 | 671.6 MiB | 396.9 MiB | 40.9% |
| 26.7.0 | deserialize documents with three ObjectIds | 1,000,000 | 671.6 MiB | 396.9 MiB | 40.9% |

