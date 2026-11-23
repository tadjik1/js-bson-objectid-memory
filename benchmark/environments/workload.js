// Shared workload for every runtime. Classic script: defines globalThis.WL.
// Loaded by node/deno/bun, by the SpiderMonkey shell, and by browsers.
(function () {
  function bytesFor(k) {                      // an ObjectId-shaped 12-byte value
    var b = new Uint8Array(12);
    var ts = 1788718889 + k * 37;
    b[0] = (ts >>> 24) & 255; b[1] = (ts >>> 16) & 255; b[2] = (ts >>> 8) & 255; b[3] = ts & 255;
    for (var j = 4; j < 12; j++) b[j] = (k * 167 + j * 61 + 29) & 255;
    return b;
  }
  // A document holding `n` ObjectIds. Measuring n=1 and n=3 and taking the slope
  // cancels the cost of the document object itself.
  function makeDoc(BSON, n, seed) {
    var doc = { value: 42 };
    for (var i = 0; i < n; i++) doc['id' + i] = new BSON.ObjectId(bytesFor(seed * 4 + i));
    return doc;
  }
  function wireFor(BSON, n) {
    var out = [];
    for (var s = 0; s < 64; s++) out.push(BSON.serialize(makeDoc(BSON, n, s)));
    return out;
  }
  globalThis.WL = {
    bytesFor: bytesFor,
    makeDoc: makeDoc,
    wireFor: wireFor,
    // --- memory, stepwise so an async prober (Chrome DevTools Protocol) can
    //     interleave its own collect/read between the steps ---
    _keep: null, _mk: null,
    memSetup: function (BSON, n, N) {
      var wire = wireFor(BSON, n);
      this._mk = function (i) { return BSON.deserialize(wire[i & 63]); };
      var s = null; for (var i = 0; i < 30000; i++) s = this._mk(i);
      if (s === undefined) throw new Error('unreachable');
      this._keep = new Array(N); for (i = 0; i < N; i++) this._keep[i] = null;
      return N;
    },
    memFill: function (N) {
      for (var i = 0; i < N; i++) this._keep[i] = this._mk(i);
      if (this._keep[N - 1] === null) throw new Error('not retained');
      return N;
    },
    memRelease: function () { this._keep = null; this._mk = null; },
    // synchronous convenience wrapper for runtimes with an in-process gc()/heap()
    perObjectId: function (BSON, gc, heap, N) {
      N = N || 200000;
      var self = this;
      function perDoc(n) {
        self.memSetup(BSON, n, N);
        gc(); var b = heap();
        self.memFill(N);
        gc(); var a = heap();
        var per = (a - b) / N;
        self.memRelease(); gc();
        return per;
      }
      var d1 = perDoc(1), d3 = perDoc(3);
      return { doc1: d1, doc3: d3, perObjectId: (d3 - d1) / 2 };
    },
    // --- round trip PER OBJECTID, matching the candidates table: 12 bytes ->
    //     representation -> 12 bytes. Timing documents with 1 and with 1+K
    //     ObjectIds and taking the slope cancels the BSON framing entirely. ---
    roundTripPerObjectId: function (BSON, now, N, K) {
      N = N || 50000; K = K || 9;
      function slopes(n) {
        var wire = wireFor(BSON, n);
        var docs = []; for (var s = 0; s < 64; s++) docs.push(makeDoc(BSON, n, s));
        // bounded ring: the documents still escape, but the live set stays small
        // so this measures conversion rather than garbage collection.
        var RING = 2048, ring = new Array(RING), i;
        for (i = 0; i < RING; i++) ring[i] = null;
        function des() { for (i = 0; i < N; i++) ring[i & (RING - 1)] = BSON.deserialize(wire[i & 63]);
                         return ring[0]; }
        function ser() { for (i = 0; i < N; i++) BSON.serialize(docs[i & 63]); return docs[0]; }
        for (var w = 0; w < 6; w++) { des(); ser(); }      // tier up before timing
        var D = [], S = [], r, t, REPS = 9;
        for (r = 0; r < REPS; r++) {
          t = now(); if (des() === undefined) throw new Error('elided'); D.push((now() - t) / N);
          t = now(); ser(); S.push((now() - t) / N);
        }
        function med(x) { return x.slice().sort(function (p, q) { return p - q; })[(REPS - 1) >> 1]; }
        return { d: med(D), s: med(S) };
      }
      var a = slopes(1), b = slopes(1 + K);
      var des = (b.d - a.d) / K, ser = (b.s - a.s) / K;
      return { deserialize: des, serialize: ser, roundTrip: des + ser,
               doc1: a.d + a.s, docK: b.d + b.s };
    },
    // --- round trip: deserialize + serialize a 3-ObjectId document ---
    roundTrip: function (BSON, now, N) {
      N = N || 150000;
      var wire = wireFor(BSON, 3);
      var docs = []; for (var s = 0; s < 64; s++) docs.push(makeDoc(BSON, 3, s));
      var keep = new Array(N);
      function des() { for (var i = 0; i < N; i++) keep[i] = BSON.deserialize(wire[i & 63]);
                       return keep[N - 1]; }
      function ser() { for (var i = 0; i < N; i++) BSON.serialize(docs[i & 63]); }
      des(); ser(); des(); ser();                                   // warm up
      var D = [], S = [], r;
      for (r = 0; r < 5; r++) {
        var t0 = now(); des(); D.push((now() - t0) / N);
        var t1 = now(); ser(); S.push((now() - t1) / N);
        for (var i = 0; i < N; i++) keep[i] = null;
      }
      function med(x) { return x.slice().sort(function (p, q) { return p - q; })[2]; }
      return { deserialize: med(D), serialize: med(S), roundTrip: med(D) + med(S) };
    }
  };
})();
