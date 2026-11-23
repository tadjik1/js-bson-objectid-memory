# The same ObjectId, measured in six environments

Real `bson@7.3.1` (a `Buffer` per ObjectId) against real `bson@7.3.2` (four
packed integers), on V8, JavaScriptCore and SpiderMonkey.

    npm i bson-before@npm:bson@7.3.1 bson-after@npm:bson@7.3.2
    npx playwright install chromium firefox webkit

    node --expose-gc run-node.mjs [before|after]
    deno run --v8-flags=--expose-gc --allow-read --allow-env --node-modules-dir=manual run-node.mjs
    bun run-node.mjs
    node run-browser.mjs                       # chromium, firefox, webkit
    ./js sm-run.js before                      # SpiderMonkey shell, for Firefox's engine

`index.html` is self-contained: open it in real Chrome, Firefox or Safari and it
runs the same workload with no server.

## What the harness has to get right

**Memory is read as a slope.** A document with three ObjectIds minus a document
with one, halved. That cancels the cost of the document object itself, so the
number is the ObjectId and nothing else. `new ObjectId(bytes)` would measure 136 B
rather than 152 B, because it keeps a view on bytes it did not allocate; only the
deserializer gives each ObjectId its own twelve pooled bytes.

**Round trip is read as a slope too.** Documents with one and with ten ObjectIds;
the difference over nine. This cancels the framing, though not the per-element
cost - the type byte, the key name, the property store - which both versions pay
identically and which is most of what is left.

**Deserialised documents go into a bounded ring buffer.** They have to escape
somewhere or escape analysis elides the allocation for the cheap representation
only. Retaining all of them instead turns the timing into a measurement of
garbage collection.

**One process per version.** Two versions through one call site make it
polymorphic.

**Six warmup rounds.** With two, SpiderMonkey had not tiered up and read 188 ns
where the settled value is 131 ns.

**Memory and timing use separate browser instances.** Measuring both in one page
left the heap in a state that moved Chrome's round trip by 8%.

## Two caveats

Firefox exposes no heap API, so its memory comes from the SpiderMonkey shell via
`byteSize()`, summed by hand over the ObjectId and its buffer. The shell and the
browser agree on timing, which is the reason to trust it for memory.

Safari exposes nothing at all, and process RSS is useless here - it read 201 B
against an exact 148 B in Chrome, and went negative on a second measurement.
Bun is the stand-in: the same engine, WebKit 26.5 against Safari 26.5.2.
