import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../constants/theme';

interface Props {
  matrix: number[][];
  height?: number;
  xRange?: [number, number]; // bed mm coords for axis labels
  yRange?: [number, number];
  // fired on touch begin/end so the parent ScrollView can release the gesture
  onInteraction?: (active: boolean) => void;
}

// Fluidd-style 3D bed mesh viewer. The canvas renderer keeps the mesh available
// offline and over Tailscale without a CDN-backed charting dependency.
// Klipper matrix[i][j] is i = Y row starting at min_y (front of bed) and
// j = X column.
function buildHtml(matrix: number[][], xRange: [number, number], yRange: [number, number]): string {
  const data = JSON.stringify({ m: matrix, xr: xRange, yr: yRange });
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<style>
  html,body{margin:0;padding:0;background:#1e1e1e;height:100%;overflow:hidden;touch-action:none;}
  canvas{display:block;width:100%;height:100%;}
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
var DATA = ${data};
(function () {
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var RAW = DATA.m;
  var XR = DATA.xr, YR = DATA.yr;
  var rz = -0.55; // azimuth
  var rx = 1.0;   // tilt
  var zoom = 1;

  if (!RAW.length || !RAW[0].length) return;

  // --- Catmull-Rom upsample: 5x5 probe grid -> ~33x33 smooth surface ---
  // raw grid looked like minecraft. spline passes exactly through the real
  // probe points so it's not lying to you, just interpolating between them
  function upsample(m, f) {
    var rows = m.length, cols = m[0].length;
    if (rows < 2 || cols < 2 || f <= 1) return m;
    function cr(p0, p1, p2, p3, t) {
      return 0.5 * ((2 * p1) + (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    }
    var C = (cols - 1) * f + 1, R = (rows - 1) * f + 1;
    var tmp = [];
    for (var i = 0; i < rows; i++) {
      var row = [];
      for (var x = 0; x < C; x++) {
        var j = Math.min(Math.floor(x / f), cols - 2);
        var t = x / f - j;
        row.push(cr(m[i][Math.max(0, j - 1)], m[i][j], m[i][j + 1], m[i][Math.min(cols - 1, j + 2)], t));
      }
      tmp.push(row);
    }
    var out = [];
    for (var y = 0; y < R; y++) {
      var i2 = Math.min(Math.floor(y / f), rows - 2);
      var t2 = y / f - i2;
      var row2 = [];
      for (var x2 = 0; x2 < C; x2++) {
        row2.push(cr(tmp[Math.max(0, i2 - 1)][x2], tmp[i2][x2], tmp[i2 + 1][x2], tmp[Math.min(rows - 1, i2 + 2)][x2], t2));
      }
      out.push(row2);
    }
    return out;
  }

  var factor = Math.max(1, Math.min(8, Math.floor(48 / Math.max(1, RAW[0].length - 1))));
  var M = upsample(RAW, factor);
  var rows = M.length, cols = M[0].length;

  function stats(m) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < m.length; i++)
      for (var j = 0; j < m[i].length; j++) {
        var v = m[i][j];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    return [lo, hi];
  }
  var rs = stats(RAW);
  var rawMin = rs[0], rawMax = rs[1];
  var rawRange = Math.max(rawMax - rawMin, 0.0001);

  // Z axis scaled to a "nice" bound covering the data
  var maxAbs = Math.max(Math.abs(rawMin), Math.abs(rawMax), 0.05);
  var NICE = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
  var zAxisMax = NICE[NICE.length - 1];
  for (var n = 0; n < NICE.length; n++) { if (NICE[n] >= maxAbs) { zAxisMax = NICE[n]; break; } }
  var ZH = 0.55; // world half-height of the axis box
  var zw = function (z) { return (z / zAxisMax) * ZH; };

  // --- RdYlBu (reversed) colormap: blue -> cream -> red ---
  var STOPS = [[49,54,149],[116,173,209],[255,255,191],[244,109,67],[165,0,38]];
  function colorFor(t) {
    t = Math.max(0, Math.min(1, t));
    var p = t * (STOPS.length - 1);
    var i = Math.min(Math.floor(p), STOPS.length - 2);
    var f = p - i;
    var a = STOPS[i], b = STOPS[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  // world point for matrix cell: X left->right, Y row 0 = front (near viewer)
  function pt(i, j) {
    var x = (cols > 1 ? j / (cols - 1) : 0.5) * 2 - 1;
    var y = 1 - (rows > 1 ? i / (rows - 1) : 0.5) * 2;
    return [x, y, zw(M[i][j])];
  }

  function fmtZ(v) { return zAxisMax < 0.2 ? v.toFixed(2) : v.toFixed(1); }

  function draw() {
    var W = canvas.clientWidth, H = canvas.clientHeight;
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, W, H);

    var scale = Math.min(W, H) * 0.33 * zoom;
    var cx = W / 2 + 14, cy = H / 2;
    var ca = Math.cos(rz), sa = Math.sin(rz);
    var cb = Math.cos(rx), sb = Math.sin(rx);

    function project(p) {
      var x = p[0] * ca - p[1] * sa;
      var y = p[0] * sa + p[1] * ca;
      var sy = y * cb - p[2] * sb;
      var depth = y * sb + p[2] * cb; // larger = nearer
      return [cx + x * scale, cy + sy * scale, depth];
    }

    function line(a, b, style, width) {
      var pa = project(a), pb = project(b);
      ctx.strokeStyle = style;
      ctx.lineWidth = width || 1;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
    }

    var GRID = 'rgba(255,255,255,0.10)';
    var EDGE = 'rgba(255,255,255,0.25)';
    var zf = -ZH, zt = ZH;
    var ticks = [-1, -0.5, 0, 0.5, 1];

    // far walls (smaller depth = farther away)
    var farX = project([1, 0, 0])[2] < project([-1, 0, 0])[2] ? 1 : -1;
    var farY = project([0, 1, 0])[2] < project([0, -1, 0])[2] ? 1 : -1;
    var nearX = -farX, nearY = -farY;

    // floor grid
    var t, k;
    for (k = 0; k < ticks.length; k++) {
      t = ticks[k];
      line([t, -1, zf], [t, 1, zf], GRID);
      line([-1, t, zf], [1, t, zf], GRID);
    }
    // far X wall grid (x = farX plane)
    for (k = 0; k < ticks.length; k++) {
      t = ticks[k];
      line([farX, t, zf], [farX, t, zt], GRID);
      line([farX, -1, t * ZH], [farX, 1, t * ZH], GRID);
    }
    // far Y wall grid (y = farY plane)
    for (k = 0; k < ticks.length; k++) {
      t = ticks[k];
      line([t, farY, zf], [t, farY, zt], GRID);
      line([-1, farY, t * ZH], [1, farY, t * ZH], GRID);
    }
    // box edges
    line([-1, -1, zf], [1, -1, zf], EDGE); line([-1, 1, zf], [1, 1, zf], EDGE);
    line([-1, -1, zf], [-1, 1, zf], EDGE); line([1, -1, zf], [1, 1, zf], EDGE);
    line([farX, farY, zf], [farX, farY, zt], EDGE);
    line([farX, nearY, zf], [farX, nearY, zt], EDGE);
    line([nearX, farY, zf], [nearX, farY, zt], EDGE);
    line([farX, farY, zt], [farX, nearY, zt], EDGE);
    line([farX, farY, zt], [nearX, farY, zt], EDGE);

    // --- surface ---
    var quads = [];
    for (var i = 0; i < rows - 1; i++) {
      for (var j = 0; j < cols - 1; j++) {
        var p00 = project(pt(i, j));
        var p01 = project(pt(i, j + 1));
        var p11 = project(pt(i + 1, j + 1));
        var p10 = project(pt(i + 1, j));
        var avgZ = (M[i][j] + M[i][j + 1] + M[i + 1][j + 1] + M[i + 1][j]) / 4;
        quads.push({
          pts: [p00, p01, p11, p10],
          depth: (p00[2] + p01[2] + p11[2] + p10[2]) / 4,
          color: colorFor((avgZ - rawMin) / rawRange)
        });
      }
    }
    quads.sort(function (a, b) { return a.depth - b.depth; });
    for (var q = 0; q < quads.length; q++) {
      var quad = quads[q];
      ctx.beginPath();
      ctx.moveTo(quad.pts[0][0], quad.pts[0][1]);
      ctx.lineTo(quad.pts[1][0], quad.pts[1][1]);
      ctx.lineTo(quad.pts[2][0], quad.pts[2][1]);
      ctx.lineTo(quad.pts[3][0], quad.pts[3][1]);
      ctx.closePath();
      ctx.fillStyle = quad.color;
      ctx.fill();
      ctx.strokeStyle = quad.color; // seal anti-aliasing seams
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // --- axis labels ---
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    function lbl(p, text, dx, dy) {
      var s = project(p);
      ctx.fillText(text, s[0] + (dx || 0), s[1] + (dy || 0));
    }
    // X labels along near-Y bottom edge (world x -1..1 -> XR mm)
    for (k = 0; k < ticks.length; k++) {
      t = ticks[k];
      var xmm = XR[0] + (t + 1) / 2 * (XR[1] - XR[0]);
      lbl([t, nearY * 1.08, zf], String(Math.round(xmm)), 0, 12);
    }
    lbl([0, nearY * 1.3, zf], 'X', 0, 16);
    // Y labels along near-X bottom edge (world y +1 = front = YR[0])
    for (k = 0; k < ticks.length; k++) {
      t = ticks[k];
      var ymm = YR[0] + (1 - t) / 2 * (YR[1] - YR[0]);
      lbl([nearX * 1.1, t, zf], String(Math.round(ymm)), nearX * 8, 4);
    }
    lbl([nearX * 1.35, 0, zf], 'Y', nearX * 10, 4);
    // Z labels on the far-X / near-Y vertical edge
    for (k = 0; k < ticks.length; k++) {
      t = ticks[k];
      lbl([farX, nearY, t * ZH], fmtZ(t * zAxisMax), farX * 16, 3);
    }
    lbl([farX, nearY, ZH * 1.25], 'Z', farX * 16, 0);

    // --- legend (left) ---
    var lx = 12, ly = 26, lh = H - 64, lw = 10;
    var grad = ctx.createLinearGradient(0, ly, 0, ly + lh);
    for (var g = 0; g <= 10; g++) grad.addColorStop(g / 10, colorFor(1 - g / 10));
    ctx.fillStyle = grad;
    ctx.fillRect(lx, ly, lw, lh);
    ctx.strokeStyle = EDGE;
    ctx.strokeRect(lx, ly, lw, lh);
    ctx.fillStyle = '#ccc';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(rawMax.toFixed(4), lx + lw + 5, ly + 9);
    ctx.fillText(rawMin.toFixed(4), lx + lw + 5, ly + lh);

    // --- range (top right) ---
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Range: ' + rawRange.toFixed(4), W - 10, 18);
  }

  // --- input: one finger orbits, two fingers pinch-zoom ---
  var lastX = 0, lastY = 0, dragging = false;
  var pinchDist = 0;
  var rafPending = false;

  function redraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; draw(); });
  }

  function dist(t0, t1) {
    var dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function orbit(x, y) {
    var k = 3.4 / Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
    rz += (x - lastX) * k;
    rx = Math.max(0.1, Math.min(1.55, rx + (y - lastY) * k * 0.8));
    lastX = x; lastY = y;
    redraw();
  }

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      dragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      dragging = false;
      pinchDist = dist(e.touches[0], e.touches[1]);
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
      orbit(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      var d = dist(e.touches[0], e.touches[1]);
      if (pinchDist > 0) {
        zoom = Math.max(0.5, Math.min(3.5, zoom * (d / pinchDist)));
        redraw();
      }
      pinchDist = d;
    }
  }, { passive: false });

  function endTouch(e) {
    e.preventDefault();
    if (e.touches.length === 0) { dragging = false; pinchDist = 0; }
    else if (e.touches.length === 1) {
      dragging = true;
      pinchDist = 0;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    }
  }
  canvas.addEventListener('touchend', endTouch, { passive: false });
  canvas.addEventListener('touchcancel', endTouch, { passive: false });

  canvas.addEventListener('mousedown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  canvas.addEventListener('mousemove', function (e) { if (dragging) orbit(e.clientX, e.clientY); });
  canvas.addEventListener('mouseup', function () { dragging = false; });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoom = Math.max(0.5, Math.min(3.5, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    redraw();
  }, { passive: false });
  window.addEventListener('resize', redraw);

  draw();
})();
</script>
</body>
</html>`;
}

export default function BedMesh3D({
  matrix,
  height = 420,
  xRange = [0, 270],
  yRange = [0, 270],
  onInteraction,
}: Props) {
  const html = useMemo(() => buildHtml(matrix, xRange, yRange), [matrix, xRange, yRange]);

  return (
    <View
      style={[styles.card, { height }]}
      onTouchStart={() => onInteraction?.(true)}
      onTouchEnd={(e) => {
        if (e.nativeEvent.touches.length === 0) onInteraction?.(false);
      }}
      onTouchCancel={() => onInteraction?.(false)}
    >
      <WebView
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        scrollEnabled={false}
        javaScriptEnabled
        nestedScrollEnabled={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: colors.card,
  },
});
