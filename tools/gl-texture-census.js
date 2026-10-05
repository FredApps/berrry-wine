// Preload for test/run.js: census of every OpenGL texture upload a guest makes,
// without editing lib/gl-compat.js or run.js.
//
//   node -r ./tools/gl-texture-census.js test/run.js --app=... --headless-gl \
//     --quiet-api --max-batches=175000 --max-seconds=900
//
// Every GL_TEXCENSUS_EVERY_MS (default 10000) it prints the histogram so far,
// and once more at exit. One row per distinct upload shape:
//
//   IMG 128x128 fmt=0x1908 type=0x1401   n=412  blank=0    maxByte=255
//   SUB 128x128 fmt=0x1908 type=0x1401   n=903  blank=903  maxByte=0
//
//   IMG/SUB   glTexImage2D vs glTexSubImage2D
//   fmt/type  the GL format and type enums the guest passed
//   n         how many uploads of that shape happened
//   blank     how many of them were ENTIRELY ZERO BYTES
//   maxByte   the largest byte value ever seen in that shape
//
// `blank` is the column this tool exists for. A renderer that draws geometry
// but shows it black is usually not missing the draw and not missing the base
// texture -- it is multiplying by a lightmap that arrived as zeros. A shape
// with n large and blank == n is that lightmap, and it says the bug is on the
// upload path (wrong pointer, wrong byte count, wrong stride) rather than in
// the blend state, which is where that symptom otherwise sends you.
//
// Counts are load-immune, so this is safe to read on a busy box.
'use strict';

const compat = require('../lib/gl-compat.js');

const EVERY_MS = parseInt(process.env.GL_TEXCENSUS_EVERY_MS || '10000', 10);
const shapes = new Map();

function record(r) {
  const key = `${r.sub ? 'SUB' : 'IMG'} ${r.w}x${r.h} fmt=0x${r.format.toString(16)} type=0x${r.type.toString(16)}`;
  let s = shapes.get(key);
  if (!s) { s = { n: 0, blank: 0, maxByte: 0, bytes: 0 }; shapes.set(key, s); }
  s.n++;
  s.bytes += r.n;
  if (r.nonzero === 0) s.blank++;
  if (r.max > s.maxByte) s.maxByte = r.max;
}

function report(label) {
  const rows = [...shapes.entries()].sort((a, b) => b[1].n - a[1].n);
  if (!rows.length) { console.log(`[gl-tex] ${label}: no texture uploads seen`); return; }
  console.log(`[gl-tex] ${label}:`);
  for (const [key, s] of rows) {
    console.log(`[gl-tex]   ${key.padEnd(44)} n=${String(s.n).padStart(6)}`
      + `  blank=${String(s.blank).padStart(6)}  maxByte=${String(s.maxByte).padStart(3)}`
      + `  bytes=${s.bytes}`);
  }
}

// Vertex-stream census. The packed vertex is stride 56 (14 floats):
//   0-2 position   3-6 colour   7-8 texcoord0   9-11 normal   12-13 texcoord1
// texcoord1 is the second texture unit -- for a GoldSrc-family renderer that
// is the lightmap. A world that draws its geometry but tints every surface the
// same colour is usually sampling that unit at one constant texel, so the
// range of texcoord1 across a frame is the measurement that settles it:
// a degenerate min==max means the coordinates never varied.
const vtx = {
  n: 0, t1const: 0,
  t0s: [Infinity, -Infinity], t0t: [Infinity, -Infinity],
  t1s: [Infinity, -Infinity], t1t: [Infinity, -Infinity],
  cr: [Infinity, -Infinity], ca: [Infinity, -Infinity],
};
function span(range, v) { if (v < range[0]) range[0] = v; if (v > range[1]) range[1] = v; }
function fmt(range) {
  return range[0] === Infinity ? 'none'
    : `${range[0].toFixed(3)}..${range[1].toFixed(3)}`;
}
function reportVerts(label) {
  if (!vtx.n) { console.log(`[gl-vtx] ${label}: no vertices`); return; }
  console.log(`[gl-vtx] ${label}: vertices=${vtx.n}`);
  console.log(`[gl-vtx]   texcoord0 s=${fmt(vtx.t0s)} t=${fmt(vtx.t0t)}`);
  console.log(`[gl-vtx]   texcoord1 s=${fmt(vtx.t1s)} t=${fmt(vtx.t1t)}`
    + `  exactly-zero verts=${vtx.t1const} (${(100 * vtx.t1const / vtx.n).toFixed(1)}%)`);
  console.log(`[gl-vtx]   colour r=${fmt(vtx.cr)} a=${fmt(vtx.ca)}`);
}

const F = compat.FixedFunctionGL;
if (F && F.prototype && typeof F.prototype.enqueuePacked === 'function') {
  const origEnq = F.prototype.enqueuePacked;
  F.prototype.enqueuePacked = function (mode, vertices) {
    try {
      for (let i = 0; i + 13 < vertices.length; i += 14) {
        vtx.n++;
        span(vtx.cr, vertices[i + 3]); span(vtx.ca, vertices[i + 6]);
        span(vtx.t0s, vertices[i + 7]); span(vtx.t0t, vertices[i + 8]);
        const s1 = vertices[i + 12], t1 = vertices[i + 13];
        span(vtx.t1s, s1); span(vtx.t1t, t1);
        if (s1 === 0 && t1 === 0) vtx.t1const++;
      }
    } catch (e) { /* never break the run */ }
    return origEnq.apply(this, arguments);
  };
  process.on('exit', () => reportVerts('whole run'));
}

// Draw-state census. A multi-pass renderer (GoldSrc draws world base textures
// and then modulates lightmaps over them) is only correct if the second pass
// actually blends. If it overwrites instead, the screen ends up showing the
// lightmap rather than texture*lightmap -- smooth, dim and untextured, which
// reads as "the renderer is too dark" rather than "a blend mode was dropped".
// So bucket every draw by the state it was issued under.
const draws = new Map();
const blend = { on: false, src: 0, dst: 0, depthFunc: 0, depthTest: false };
function bucketDraw(f) {
  const C = compat.constants;
  const key = `blend=${blend.on ? 'on' : 'off'}`
    + ` src=0x${blend.src.toString(16)} dst=0x${blend.dst.toString(16)}`
    + ` depth=${blend.depthTest ? 'on' : 'off'}/0x${blend.depthFunc.toString(16)}`
    + ` tex0=${f.textureUnitEnabled[0] ? 1 : 0} tex1=${f.textureUnitEnabled[1] ? 1 : 0}`
    + ` mode0=0x${(f.textureModes[0] >>> 0).toString(16)}`;
  draws.set(key, (draws.get(key) || 0) + 1);
}
// Raw state-call traffic, independent of what draws were bucketed. If the
// lightmap pass is missing entirely there is no blend enable paired with the
// modulate func; if it is present but unblended, the enables are there and the
// draws landed in a blend=off bucket instead.
const stateCalls = { enableBlend: 0, disableBlend: 0, depthMask0: 0, depthMask1: 0 };
const blendFuncs = new Map();
const clearMasks = new Map();
const depthRanges = new Map();
function reportState(label) {
  console.log(`[gl-state] ${label}: glEnable(BLEND)=${stateCalls.enableBlend}`
    + ` glDisable(BLEND)=${stateCalls.disableBlend}`
    + ` glDepthMask(0)=${stateCalls.depthMask0} glDepthMask(1)=${stateCalls.depthMask1}`);
  const rows = [...blendFuncs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [key, n] of rows) console.log(`[gl-state]   glBlendFunc ${key}  n=${n}`);
  for (const [key, n] of [...clearMasks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`[gl-state]   glClear ${key}  n=${n}`);
  }
  for (const [key, n] of [...depthRanges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`[gl-state]   glDepthRange ${key}  n=${n}`);
  }
}

function reportDraws(label) {
  const rows = [...draws.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) { console.log(`[gl-draw] ${label}: no draws`); return; }
  console.log(`[gl-draw] ${label}:`);
  for (const [key, n] of rows.slice(0, 12)) {
    console.log(`[gl-draw]   n=${String(n).padStart(7)}  ${key}`);
  }
}

const Bx = compat.OpenGLHostBridge;
if (Bx && Bx.prototype && typeof Bx.prototype._call === 'function') {
  const C = compat.constants;
  const origCall = Bx.prototype._call;
  // _call flushes any pending geometry BEFORE it handles the state change, so
  // the state update has to happen after calling through. Updating first
  // attributes every draw to the state that came after it -- which reads as
  // "the lightmap pass never blends" when in fact the disable that follows it
  // was being credited to it.
  Bx.prototype._call = function (opcode, stack, aux) {
    const result = origCall.apply(this, arguments);
    try {
      const name = compat.CALLS[opcode | 0];
      if (name === 'glBlendFunc') {
        blend.src = this._u32(stack, 0) >>> 0; blend.dst = this._u32(stack, 1) >>> 0;
        const k = `src=0x${blend.src.toString(16)} dst=0x${blend.dst.toString(16)}`;
        blendFuncs.set(k, (blendFuncs.get(k) || 0) + 1);
      } else if (name === 'glClear') {
        const m = this._u32(stack, 0) >>> 0;
        const k = `mask=0x${m.toString(16)}`
          + `${m & 0x4000 ? ' COLOR' : ''}${m & 0x100 ? ' DEPTH' : ''}${m & 0x400 ? ' STENCIL' : ''}`;
        clearMasks.set(k, (clearMasks.get(k) || 0) + 1);
      } else if (name === 'glDepthRange') {
        // GLclampd: two 8-byte doubles, so four stack dwords. Reading these as
        // f32 yields plausible-looking garbage rather than an obvious error --
        // (0,0.5) reads as 0..0 and (1,0.5) as 0..1.875, because the high dword
        // of the double 1.0 is the float 1.875 -- which is exactly the kind of
        // wrong number that gets mistaken for a renderer bug.
        const k = `${this._f64(stack, 0).toFixed(3)}..${this._f64(stack, 2).toFixed(3)}`;
        depthRanges.set(k, (depthRanges.get(k) || 0) + 1);
      } else if (name === 'glDepthFunc') {
        blend.depthFunc = this._u32(stack, 0) >>> 0;
      } else if (name === 'glDepthMask') {
        if (this._u32(stack, 0) >>> 0) stateCalls.depthMask1++; else stateCalls.depthMask0++;
      } else if (name === 'glEnable' || name === 'glDisable') {
        const cap = this._u32(stack, 0) >>> 0, on = name === 'glEnable';
        if (cap === C.BLEND) { blend.on = on; if (on) stateCalls.enableBlend++; else stateCalls.disableBlend++; }
        if (cap === C.DEPTH_TEST) blend.depthTest = on;
      }
    } catch (e) { /* never break the run */ }
    return result;
  };
}
const Fd = compat.FixedFunctionGL;
if (Fd && Fd.prototype && typeof Fd.prototype._drawGeometry === 'function') {
  const origDraw = Fd.prototype._drawGeometry;
  Fd.prototype._drawGeometry = function (geometry) {
    try { if (geometry && geometry.vertices.length) bucketDraw(this); } catch (e) {}
    return origDraw.apply(this, arguments);
  };
  process.on('exit', () => { reportDraws('whole run'); reportState('whole run'); });
}

const B = compat.OpenGLHostBridge;
if (!B || !B.prototype || typeof B.prototype._texImage !== 'function') {
  console.log('[gl-tex] lib/gl-compat.js has no OpenGLHostBridge._texImage to wrap');
} else {
  const C = compat.constants;
  const orig = B.prototype._texImage;
  B.prototype._texImage = function (frontend, stack, sub) {
    let rec = null;
    try {
      let w, h, format, type, pointer;
      if (sub) {
        w = this._u32(stack, 4); h = this._u32(stack, 5);
        format = this._u32(stack, 6); type = this._u32(stack, 7); pointer = this._u32(stack, 8);
      } else {
        w = this._u32(stack, 3); h = this._u32(stack, 4);
        format = this._u32(stack, 6); type = this._u32(stack, 7); pointer = this._u32(stack, 8);
      }
      const channels = format === C.RGB ? 3
        : (format === C.ALPHA || format === C.LUMINANCE) ? 1 : 4;
      const px = this._bytes(pointer, w * h * channels);
      let max = 0, nonzero = 0;
      if (px) {
        for (let i = 0; i < px.length; i++) {
          const v = px[i];
          if (v) { nonzero++; if (v > max) max = v; }
        }
      }
      rec = { sub, w, h, format, type, n: px ? px.length : 0, nonzero, max };
    } catch (e) { /* never let the census break the run */ }
    const r = orig.apply(this, arguments);
    if (rec) record(rec);
    return r;
  };

  const timer = setInterval(() => report('so far'), EVERY_MS);
  if (timer.unref) timer.unref();
  process.on('exit', () => report('whole run'));
}
