// Plays the printer's H.264 stream in a WebView by muxing it to fMP4 for Media
// Source Extensions.
//
// Why this exists: the U1 captures 1920x1080 @ 30fps and offers the SAME video
// three ways. Measured on the printer's own loopback:
//
//   /webcam/stream.mjpg            5453 KB/s   44 Mbit/s
//   /webcam/stream.mjpg?fps=20     2714 KB/s   22 Mbit/s
//   /webcam/stream.h264             237 KB/s    1.9 Mbit/s   <- same picture
//
// MJPEG re-sends a whole 184KB 1080p JPEG per frame, so it cannot fit down the
// printer's 2.4GHz radio (~5 MB/s) at full rate — hence the fps cap, the frames
// backing up in nginx's send queue, and ~750ms added to every other request.
// H.264 is 23x smaller and streams full 30fps in under 2 Mbit/s.
//
// The catch is that /stream.h264 is a raw Annex-B elementary stream
// (Content-Type: video/h264). No browser plays that directly, and it is not a
// container ExoPlayer understands either. But MSE will happily take fragmented
// MP4, and turning Annex-B into fMP4 is just reframing — no transcoding, no
// native module, no extra dependency. That is what this does.
//
// The alternative was WebRTC, which the printer also serves (stream-webrtc, the
// path iOS uses). Android cannot complete that handshake: neither Chrome nor a
// native RTCPeerConnection gathers a single ICE candidate on the test device.
// This route needs no ICE and no UDP — it is a plain HTTP GET.

/** Ships as one inlined script: the WebView loads from a string, not a bundle. */
function muxerScript(): string {
  return `
// ---------- bit reader, for the one SPS field we actually need ----------
function BitReader(bytes) {
  this.b = bytes; this.i = 0; this.bit = 0;
}
BitReader.prototype.u1 = function () {
  var v = (this.b[this.i] >> (7 - this.bit)) & 1;
  if (++this.bit === 8) { this.bit = 0; this.i++; }
  return v;
};
BitReader.prototype.u = function (n) {
  var v = 0;
  for (var k = 0; k < n; k++) v = (v << 1) | this.u1();
  return v >>> 0;
};
// Exponential-Golomb, how H.264 encodes most header fields.
BitReader.prototype.ue = function () {
  var zeros = 0;
  while (this.i < this.b.length && this.u1() === 0) zeros++;
  return zeros === 0 ? 0 : ((1 << zeros) - 1) + this.u(zeros);
};
BitReader.prototype.se = function () {
  var v = this.ue();
  return (v & 1) ? (v + 1) >> 1 : -(v >> 1);
};

// Strip emulation-prevention bytes (00 00 03 -> 00 00) before parsing.
function unescapeRbsp(b) {
  var out = new Uint8Array(b.length), n = 0, zeros = 0;
  for (var i = 0; i < b.length; i++) {
    if (zeros === 2 && b[i] === 3) { zeros = 0; continue; }
    out[n++] = b[i];
    zeros = b[i] === 0 ? zeros + 1 : 0;
  }
  return out.subarray(0, n);
}

// Only width/height are needed; everything before them must still be walked.
function parseSps(sps) {
  var r = new BitReader(unescapeRbsp(sps.subarray(1)));
  var profile = r.u(8);
  r.u(8);              // constraint flags + reserved
  r.u(8);              // level
  r.ue();              // seq_parameter_set_id
  var chroma = 1;
  if (profile === 100 || profile === 110 || profile === 122 || profile === 244 ||
      profile === 44 || profile === 83 || profile === 86 || profile === 118 ||
      profile === 128 || profile === 138 || profile === 139 || profile === 134) {
    chroma = r.ue();
    if (chroma === 3) r.u1();
    r.ue(); r.ue(); r.u1();
    if (r.u1()) {      // seq_scaling_matrix_present
      var lists = chroma !== 3 ? 8 : 12;
      for (var i = 0; i < lists; i++) {
        if (r.u1()) {
          var size = i < 6 ? 16 : 64, last = 8, next = 8;
          for (var j = 0; j < size; j++) {
            if (next !== 0) next = (last + r.se() + 256) % 256;
            last = next === 0 ? last : next;
          }
        }
      }
    }
  }
  r.ue();                                  // log2_max_frame_num_minus4
  var poc = r.ue();
  if (poc === 0) r.ue();
  else if (poc === 1) {
    r.u1(); r.se(); r.se();
    var n = r.ue();
    for (var k = 0; k < n; k++) r.se();
  }
  r.ue(); r.u1();                          // max_num_ref_frames, gaps_allowed
  var widthMbs = r.ue() + 1;
  var heightMapUnits = r.ue() + 1;
  var frameMbsOnly = r.u1();
  if (!frameMbsOnly) r.u1();               // mb_adaptive_frame_field_flag
  r.u1();                                  // direct_8x8_inference_flag
  var cropL = 0, cropR = 0, cropT = 0, cropB = 0;
  if (r.u1()) { cropL = r.ue(); cropR = r.ue(); cropT = r.ue(); cropB = r.ue(); }
  var subW = chroma === 1 || chroma === 2 ? 2 : 1;
  var subH = chroma === 1 ? 2 : 1;
  var w = widthMbs * 16 - (cropL + cropR) * subW;
  var h = (2 - frameMbsOnly) * heightMapUnits * 16 - (cropT + cropB) * subH * (2 - frameMbsOnly);
  return { width: w, height: h };
}

// ---------- MP4 box construction ----------
function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
function u16(v) { return [(v >>> 8) & 255, v & 255]; }
function str4(s) { return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]; }

function box(type) {
  var parts = [], total = 8;
  for (var i = 1; i < arguments.length; i++) {
    var p = arguments[i];
    if (!p) continue;
    p = p instanceof Uint8Array ? p : new Uint8Array(p);
    parts.push(p); total += p.length;
  }
  var out = new Uint8Array(total);
  out.set(u32(total), 0); out.set(str4(type), 4);
  var off = 8;
  for (var j = 0; j < parts.length; j++) { out.set(parts[j], off); off += parts[j].length; }
  return out;
}

var TIMESCALE = 90000;

function initSegment(sps, pps, w, h) {
  var ftyp = box('ftyp', str4('isom').concat(u32(512), str4('isom'), str4('iso2'), str4('avc1'), str4('mp41')));
  var avcC = box('avcC', [1, sps[1], sps[2], sps[3], 0xff, 0xe1]
    .concat(u16(sps.length)).concat(Array.from(sps))
    .concat([1]).concat(u16(pps.length)).concat(Array.from(pps)));
  var avc1 = box('avc1',
    [0, 0, 0, 0, 0, 0].concat(u16(1))
      .concat(u16(0), u16(0), u32(0), u32(0), u32(0))
      .concat(u16(w), u16(h))
      .concat(u32(0x00480000), u32(0x00480000), u32(0), u16(1))
      .concat(new Array(32).fill(0))
      .concat(u16(0x0018), [255, 255]),
    avcC);
  var stsd = box('stsd', u32(0).concat(u32(1)), avc1);
  var stbl = box('stbl', stsd,
    box('stts', u32(0).concat(u32(0))),
    box('stsc', u32(0).concat(u32(0))),
    box('stsz', u32(0).concat(u32(0), u32(0))),
    box('stco', u32(0).concat(u32(0))));
  var dinf = box('dinf', box('dref', u32(0).concat(u32(1)), box('url ', [0, 0, 0, 1])));
  var minf = box('minf', box('vmhd', [0, 0, 0, 1].concat(u16(0), u16(0), u16(0), u16(0))), dinf, stbl);
  var mdia = box('mdia',
    box('mdhd', u32(0).concat(u32(0), u32(0), u32(TIMESCALE), u32(0), u16(0x55c4), u16(0))),
    box('hdlr', u32(0).concat(u32(0), str4('vide'), u32(0), u32(0), u32(0), [0])),
    minf);
  var tkhd = box('tkhd', [0, 0, 0, 7].concat(
    u32(0), u32(0), u32(1), u32(0), u32(0),
    u32(0), u32(0), u16(0), u16(0), u16(0), u16(0),
    u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000),
    u32(w << 16), u32(h << 16)));
  var trak = box('trak', tkhd, mdia);
  var mvhd = box('mvhd', u32(0).concat(u32(0), u32(0), u32(TIMESCALE), u32(0),
    u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
    u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000),
    u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(2)));
  var mvex = box('mvex', box('trex', u32(0).concat(u32(1), u32(1), u32(0), u32(0), u32(0))));
  var moov = box('moov', mvhd, trak, mvex);
  var out = new Uint8Array(ftyp.length + moov.length);
  out.set(ftyp, 0); out.set(moov, ftyp.length);
  return out;
}

function fragment(seq, decodeTime, duration, payload, isKey) {
  // sample_depends_on=2 (I-frame) vs depends_on=1 + non_sync=1.
  var flags = isKey ? 0x02000000 : 0x01010000;
  var mfhd = box('mfhd', u32(0).concat(u32(seq)));
  // tfhd flags 0x020000 = default-base-is-moof, and nothing else: adding
  // default-sample-flags-present here would make a parser read a field we do
  // not write, and the whole fragment misparses.
  var tfhd = box('tfhd', [0, 0x02, 0x00, 0x00].concat(u32(1)));
  var tfdt = box('tfdt', [1, 0, 0, 0].concat(u32(0), u32(decodeTime)));
  // trun flags 0x000701 = data-offset + sample-duration + sample-size +
  // sample-flags. NOT 0x0f01 — that also sets composition-time-offsets, which
  // would make the parser expect a fourth per-sample field.
  var trun = box('trun', [0, 0x00, 0x07, 0x01].concat(u32(1), u32(0),
    u32(duration), u32(payload.length), u32(flags)));
  var traf = box('traf', tfhd, tfdt, trun);
  var moof = box('moof', mfhd, traf);
  // data_offset is measured from the start of the moof and points at the mdat
  // payload. trun is the last box inside moof, so its offset is derivable
  // rather than hardcoded: +8 box header, +4 version/flags, +4 sample_count.
  moof.set(u32(moof.length + 8), moof.length - trun.length + 16);
  var mdat = box('mdat', payload);
  var out = new Uint8Array(moof.length + mdat.length);
  out.set(moof, 0); out.set(mdat, moof.length);
  return out;
}
`;
}

/**
 * A player for the printer's raw H.264 endpoint.
 *
 * Falls back by posting `failMessage` to React Native, so the caller can drop to
 * the MJPEG bridge on any device where MSE or the codec is unavailable.
 */
export function buildH264PlayerHtml(
  url: string,
  readyMessage: string,
  failMessage: string,
): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden;}
video{width:100%;height:100%;object-fit:contain;display:block;background:#000;}</style>
</head><body>
<video id="v" autoplay muted playsinline></video>
<script>
${muxerScript()}

var SRC = ${JSON.stringify(url)};
var video = document.getElementById('v');
var stopped = false;
var notified = false;
var failed = false;

function post(msg) {
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(msg);
  }
}
function ready() { if (!notified) { notified = true; post(${JSON.stringify(readyMessage)}); } }
function fail() { if (!failed) { failed = true; post(${JSON.stringify(failMessage)}); } }

// Codec string comes from the SPS: profile / constraints / level.
function codecFor(sps) {
  function hex(b) { return ('0' + b.toString(16)).slice(-2); }
  return 'video/mp4; codecs="avc1.' + hex(sps[1]) + hex(sps[2]) + hex(sps[3]) + '"';
}

if (!window.MediaSource) { fail(); } else { start(); }

function start() {
  var ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  ms.addEventListener('sourceopen', function () { pump(ms); });
  // A decode error means this device cannot play what we built; hand back.
  video.addEventListener('error', fail);
}

async function pump(ms) {
  var sb = null;
  var queue = [];
  var sps = null, pps = null;
  var seq = 1, decodeTime = 0;
  var SAMPLE_DURATION = TIMESCALE / 30;

  function flush() {
    if (!sb || sb.updating || !queue.length) return;
    try { sb.appendBuffer(queue.shift()); } catch (e) { fail(); }
  }

  try {
    var res = await fetch(SRC, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error('http ' + res.status);
    var reader = res.body.getReader();
    var buf = new Uint8Array(0);
    var pending = [];     // NALs of the access unit being assembled
    var pendingKey = false;

    function emit() {
      if (!pending.length || !sb) { pending = []; return; }
      // Annex-B start codes become 4-byte lengths (AVCC), what fMP4 wants.
      var total = 0, i;
      for (i = 0; i < pending.length; i++) total += 4 + pending[i].length;
      var payload = new Uint8Array(total), off = 0;
      for (i = 0; i < pending.length; i++) {
        payload.set(u32(pending[i].length), off); off += 4;
        payload.set(pending[i], off); off += pending[i].length;
      }
      queue.push(fragment(seq++, decodeTime, SAMPLE_DURATION, payload, pendingKey));
      decodeTime += SAMPLE_DURATION;
      pending = []; pendingKey = false;
      flush();
      ready();
    }

    function onNal(nal) {
      var type = nal[0] & 0x1f;
      if (type === 7) { if (!sps) sps = nal; return; }
      if (type === 8) { if (!pps) pps = nal; return; }
      if (type === 9) { emit(); return; }   // access unit delimiter
      if (type === 6) return;               // SEI, not needed
      if (sps && pps && !sb) {
        var dim = parseSps(sps);
        try {
          sb = ms.addSourceBuffer(codecFor(sps));
        } catch (e) { fail(); return; }
        sb.addEventListener('updateend', flush);
        queue.push(initSegment(sps, pps, dim.width, dim.height));
        flush();
      }
      if (!sb) return;
      if (type === 5) pendingKey = true;
      pending.push(nal);
    }

    for (;;) {
      var r = await reader.read();
      if (r.done || stopped) break;
      var nb = new Uint8Array(buf.length + r.value.length);
      nb.set(buf, 0); nb.set(r.value, buf.length);
      buf = nb;

      // Split on 00 00 01 / 00 00 00 01, keeping the tail for the next chunk.
      var starts = [];
      for (var i = 0; i + 3 < buf.length; i++) {
        if (buf[i] !== 0 || buf[i + 1] !== 0) continue;
        var len = 0;
        if (buf[i + 2] === 1) len = 3;
        else if (buf[i + 2] === 0 && buf[i + 3] === 1) len = 4;
        if (!len) continue;
        starts.push([i, len]);
        // Skip the whole start code. Without this a 4-byte 00 00 00 01 also
        // matches the 3-byte pattern at i+1, so one start code yields two
        // entries and the "NAL" between them is empty — which reaches the muxer
        // as a zero length prefix and the stream fails to decode.
        i += len - 1;
      }
      if (starts.length > 1) {
        for (var s = 0; s < starts.length - 1; s++) {
          var from = starts[s][0] + starts[s][1];
          onNal(buf.subarray(from, starts[s + 1][0]));
        }
        buf = buf.slice(starts[starts.length - 1][0]);
      } else if (buf.length > 4000000) {
        buf = new Uint8Array(0);   // no start code in 4MB: not a stream we know
        fail();
        return;
      }

      // Never let MSE hold more than a couple of seconds of video.
      if (sb && !sb.updating && video.buffered.length) {
        var end = video.buffered.end(video.buffered.length - 1);
        if (end - video.currentTime > 2) video.currentTime = end - 0.1;
        var startB = video.buffered.start(0);
        if (video.currentTime - startB > 8) {
          try { sb.remove(startB, video.currentTime - 4); } catch (e) {}
        }
      }
    }
  } catch (e) {
    if (!stopped) fail();
  }
}

function stopPlayer() { stopped = true; try { video.pause(); } catch (e) {} }
window.addEventListener('pagehide', stopPlayer);
window.addEventListener('beforeunload', stopPlayer);
</script>
</body></html>`;
}

/** Rewrites a /webcam/webrtc (or snapshot) URL onto the H.264 endpoint. */
export function resolveH264Url(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/\/webcam\//i.test(parsed.pathname)) return undefined;
    parsed.pathname = '/webcam/stream.h264';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}
