// minimal ASCII TextEncoder/TextDecoder — the shell has none, bson needs them for keys
globalThis.TextEncoder = function () {};
TextEncoder.prototype.encode = function (s) { var a = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
TextEncoder.prototype.encodeInto = function (s, dst) { var n = Math.min(s.length, dst.length);
  for (var i = 0; i < n; i++) dst[i] = s.charCodeAt(i) & 255; return { read: n, written: n }; };
globalThis.TextDecoder = function () {};
TextDecoder.prototype.decode = function (a) { var s = '';
  for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s; };

var VER = scriptArgs[0];
load('../bsonvers/node_modules/bson-' + VER + '/lib/bson.bundle.js');
load('../env/workload.js');

var wire = WL.wireFor(BSON, 3);
var doc  = BSON.deserialize(wire[0]);
var oid  = doc.id0;
var props = Object.getOwnPropertyNames(oid);

// byteSize() is shallow, so walk the ObjectId's own references explicitly
var total = byteSize(oid), parts = ['object ' + byteSize(oid)];
if (props.indexOf('buffer') >= 0) {
  total += byteSize(oid.buffer); parts.push('view ' + byteSize(oid.buffer));
  var ab = oid.buffer.buffer;
  if (ab && byteSize(ab) && oid.buffer.byteLength < 96) { /* data is inline for small views */ }
  else if (ab) { total += byteSize(ab); parts.push('ArrayBuffer ' + byteSize(ab)); }
}
print('  bson-' + VER + '  props: ' + props.join(',') );
print('    ' + parts.join(' + ') + '  =  ' + total + ' B per ObjectId');

var t = WL.roundTripPerObjectId(BSON, function () { return performance.now() * 1e6; }, 40000);
print('    per ObjectId: deserialize ' + t.deserialize.toFixed(0) + ' ns  serialize ' + t.serialize.toFixed(0) + ' ns  round trip ' + t.roundTrip.toFixed(0) + ' ns');
