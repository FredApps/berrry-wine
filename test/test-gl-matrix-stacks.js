#!/usr/bin/env node
'use strict';

// The WAT matrix stacks (src/09a8f-gl-matrix.wat) against the JavaScript ones
// they are lifted from (lib/gl-compat.js:112-166, :450-465).
//
// WHY A MIRROR TEST. GL's transform state is the reason the OpenGL command
// stream is a log of calls rather than a backend-neutral descriptor: nothing
// on the WAT side knows what the matrices are, so nothing on that side can
// lower a draw (docs/gl-software-path-design.md). Moving that state into WAT
// is only safe if the two agree to the last bit, because for as long as both
// exist a disagreement shows up as geometry that is subtly wrong in one
// backend and right in the other -- the hardest kind of rendering bug to see.
// So this compares raw f32 bit patterns, not values, for every operation
// whose JS implementation is exported and can serve as a real oracle.
//
// THE ONE EXCEPTION, stated plainly. lib/gl-compat.js exports identity(),
// multiply(), frustum() and ortho(), so those four are checked against the
// actual shipping code. translation(), scale() and rotation() are module-local
// and cannot be imported; the references below are transcribed from them. A
// transcription cannot catch a misreading shared by both copies, so those
// three additionally get a semantic check -- transform a known vector and
// assert where it lands -- which does not depend on either transcription.
//
// Rotation is compared with a tolerance rather than bitwise. JS normalizes the
// axis with Math.hypot, which is correctly rounded; wasm has no such
// instruction and 09a8f uses sqrt(x*x+y*y+z*z), so a rotation about a non-unit
// axis can differ in the last ulp. Rotations about the unit axes agree exactly
// and are checked that way.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { identity, multiply, frustum, ortho } = require('../lib/gl-compat.js');

const MODELVIEW = 0x1700, PROJECTION = 0x1701, TEXTURE = 0x1702;
const GL_STACK_OVERFLOW = 0x0503, GL_STACK_UNDERFLOW = 0x0504;

// Transcribed from lib/gl-compat.js:133-166. See the header for why these are
// copies and what backs them up.
function translation(x, y, z) {
  const out = identity(); out[12] = x; out[13] = y; out[14] = z; return out;
}
function scale(x, y, z) {
  const out = identity(); out[0] = x; out[5] = y; out[10] = z; return out;
}
function rotation(angle, x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  x /= length; y /= length; z /= length;
  const r = angle * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r), t = 1 - c;
  return new Float32Array([
    x * x * t + c, y * x * t + z * s, z * x * t - y * s, 0,
    x * y * t - z * s, y * y * t + c, z * y * t + x * s, 0,
    x * z * t + y * s, y * z * t - x * s, z * z * t + c, 0,
    0, 0, 0, 1]);
}

// The JS side of the mirror: the same stack discipline as FixedFunctionGL,
// reduced to the matrix state. The class itself needs a live WebGL program to
// construct (lib/gl-compat.js:338), so it cannot be instantiated headless;
// _stack/_matrix/_replaceMatrix/_multMatrix are reproduced here exactly.
class JsStacks {
  constructor() {
    this.mode = MODELVIEW;
    this.activeTexture = 0;
    this.stacks = [[identity()], [identity()], [identity()], [identity()]];
  }
  sel() {
    if (this.mode === PROJECTION) return 1;
    if (this.mode === TEXTURE) return 2 + (this.activeTexture ? 1 : 0);
    return 0;
  }
  stack() { return this.stacks[this.sel()]; }
  top() { const s = this.stack(); return s[s.length - 1]; }
  replace(v) { const s = this.stack(); s[s.length - 1] = new Float32Array(v); }
  mult(v) { this.replace(multiply(this.top(), v)); }
}

// A scripted sequence, applied to both sides by the two appliers below. Kept
// as data so the two can never drift into running different programs.
const SCRIPT = [
  ['mode', PROJECTION],
  ['frustum', -1, 1, -0.75, 0.75, 0.1, 4096],
  ['mode', MODELVIEW],
  ['translate', 3.5, -12.25, 0.125],
  ['rotate', 90, 0, 1, 0],
  ['push'],
  ['scale', 2, 2, 2],
  ['translate', 1, 2, 3],
  ['rotate', -33.75, 0, 0, 1],
  ['pop'],
  ['translate', -1, -1, -1],
  ['mode', TEXTURE],
  ['scale', 0.5, 0.5, 1],
  ['texunit', 1],
  ['ortho', 0, 640, 480, 0, -1, 1],
  ['translate', 8, 8, 0],
  ['texunit', 0],
  ['translate', 100, 0, 0],
  ['mode', MODELVIEW],
  ['loadIdentity'],
  ['rotate', 17.5, 0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
  ['translate', 1, 1, 1],
];

// Which script steps are allowed a tolerance rather than a bitwise match, and
// why: see the header. Only a rotation about a non-axis-aligned vector.
const inexact = step => step[0] === 'rotate'
  && [step[2], step[3], step[4]].filter(v => v !== 0).length > 1;

function applyJs(js, step) {
  const [op, ...a] = step;
  switch (op) {
    case 'mode': js.mode = a[0]; break;
    case 'texunit': js.activeTexture = a[0] ? 1 : 0; break;
    case 'loadIdentity': js.replace(identity()); break;
    case 'push': js.stack().push(new Float32Array(js.top())); break;
    case 'pop': { const s = js.stack(); if (s.length > 1) s.pop(); break; }
    case 'translate': js.mult(translation(a[0], a[1], a[2])); break;
    case 'scale': js.mult(scale(a[0], a[1], a[2])); break;
    case 'rotate': js.mult(rotation(a[0], a[1], a[2], a[3])); break;
    case 'frustum': js.mult(frustum(a[0], a[1], a[2], a[3], a[4], a[5])); break;
    case 'ortho': js.mult(ortho(a[0], a[1], a[2], a[3], a[4], a[5])); break;
    default: throw new Error(`unknown op ${op}`);
  }
}

function applyWat(e, step) {
  const [op, ...a] = step;
  switch (op) {
    case 'mode': e.gl_mtx_set_mode(a[0]); break;
    case 'texunit': e.gl_mtx_set_active_texture(a[0]); break;
    case 'loadIdentity': e.gl_mtx_load_identity(); break;
    case 'push': e.gl_mtx_push(); break;
    case 'pop': e.gl_mtx_pop(); break;
    case 'translate': e.gl_mtx_translate(a[0], a[1], a[2]); break;
    case 'scale': e.gl_mtx_scale(a[0], a[1], a[2]); break;
    case 'rotate': e.gl_mtx_rotate(a[0], a[1], a[2], a[3]); break;
    case 'frustum': e.gl_mtx_frustum(a[0], a[1], a[2], a[3], a[4], a[5]); break;
    case 'ortho': e.gl_mtx_ortho(a[0], a[1], a[2], a[3], a[4], a[5]); break;
    default: throw new Error(`unknown op ${op}`);
  }
}

// Column-major matrix times a column vector, for the semantic checks.
function transform(m, x, y, z) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / (w || 1),
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / (w || 1),
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / (w || 1),
  ];
}

(async () => {
  const { exports: e, memory } = await bootRenderHarness();
  const read = ptr => new Float32Array(memory.buffer.slice(ptr, ptr + 64));
  const top = () => read(e.gl_mtx_top_ptr() >>> 0);
  const stackAt = (s, i) => read(e.gl_mtx_stack_ptr(s, i) >>> 0);

  const bits = m => {
    const u = new Uint32Array(m.buffer.slice(0));
    return [...u].map(v => v.toString(16).padStart(8, '0')).join(' ');
  };
  const compare = (label, watM, jsM, tolerance) => {
    if (!tolerance) {
      assert.strictEqual(bits(watM), bits(jsM),
        `${label}: WAT and JS matrices differ bit for bit\n`
        + `  wat ${[...watM].join(', ')}\n  js  ${[...jsM].join(', ')}`);
      return;
    }
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(watM[i] - jsM[i]) <= tolerance,
        `${label}: element ${i} differs by more than ${tolerance}:`
        + ` wat ${watM[i]} vs js ${jsM[i]}`);
    }
  };

  // Every stack starts one deep holding identity, as GL requires.
  for (let s = 0; s < 4; s++) {
    assert.strictEqual(e.gl_mtx_depth(s), 0, `stack ${s} starts one entry deep`);
  }
  assert.strictEqual(e.gl_mtx_selected(), 0, 'GL_MODELVIEW is the initial mode');
  compare('initial modelview', top(), identity());

  // The script, checked after EVERY step rather than only at the end, so a
  // disagreement names the operation that introduced it instead of the one
  // that happened to be last.
  const js = new JsStacks();
  let tolerated = 0;
  for (const [n, step] of SCRIPT.entries()) {
    applyJs(js, step);
    applyWat(e, step);
    const label = `step ${n} (${step.join(' ')})`;
    assert.strictEqual(e.gl_mtx_selected(), js.sel(), `${label}: selected stack`);
    assert.strictEqual(e.gl_mtx_depth(js.sel()), js.stack().length - 1,
      `${label}: stack depth`);
    // A tolerated step poisons every later comparison on that stack, so from
    // the first one on, that stack is compared loosely too.
    if (inexact(step)) tolerated++;
    compare(label, top(), js.top(), tolerated ? 1e-6 : 0);
  }
  assert.strictEqual(tolerated, 1,
    'exactly one script step should need a tolerance; if this changed, the'
    + ' comment about Math.hypot needs revisiting');

  // Every stack, not just the selected one, matches -- a stack the script left
  // alone must have been left alone.
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < js.stacks[s].length; i++) {
      compare(`stack ${s} entry ${i}`, stackAt(s, i), js.stacks[s][i], 1e-6);
    }
  }

  // Semantic checks, which depend on neither transcription.
  e.gl_mtx_set_mode(MODELVIEW);
  e.gl_mtx_load_identity();
  e.gl_mtx_translate(10, 20, 30);
  assert.deepStrictEqual(transform(top(), 1, 2, 3), [11, 22, 33],
    'translate moves a point by the offset');
  e.gl_mtx_load_identity();
  e.gl_mtx_scale(2, 3, 4);
  assert.deepStrictEqual(transform(top(), 1, 1, 1), [2, 3, 4],
    'scale multiplies each axis');
  // GL composes right-to-left: the translate is applied to the point first,
  // then the rotation, which is what makes the order observable.
  e.gl_mtx_load_identity();
  e.gl_mtx_rotate(90, 0, 0, 1);
  e.gl_mtx_translate(1, 0, 0);
  {
    const p = transform(top(), 0, 0, 0);
    assert.ok(Math.abs(p[0]) < 1e-6 && Math.abs(p[1] - 1) < 1e-6
      && Math.abs(p[2]) < 1e-6,
      `90 degrees about +Z takes (1,0,0) to (0,1,0), got ${p.join(', ')}`);
  }
  // Rotations about a unit axis need no tolerance in the comparison itself.
  e.gl_mtx_load_identity();
  e.gl_mtx_rotate(37.5, 1, 0, 0);
  compare('unit-axis rotation is exact', top(),
    multiply(identity(), rotation(37.5, 1, 0, 0)));

  // Ortho maps its box corners onto the NDC cube, which is the whole point of
  // it and is independent of how the matrix is spelled.
  e.gl_mtx_load_identity();
  e.gl_mtx_ortho(0, 640, 480, 0, -1, 1);
  {
    const tl = transform(top(), 0, 0, 0);
    const br = transform(top(), 640, 480, 0);
    assert.ok(Math.abs(tl[0] + 1) < 1e-6 && Math.abs(tl[1] - 1) < 1e-6,
      `ortho maps (0,0) to the top-left of NDC, got ${tl.join(', ')}`);
    assert.ok(Math.abs(br[0] - 1) < 1e-6 && Math.abs(br[1] + 1) < 1e-6,
      `ortho maps (640,480) to the bottom-right of NDC, got ${br.join(', ')}`);
    // Depth as well as x and y. Without this the z row is only ever checked
    // against the transcribed reference, and a wrong scale there survives:
    // an injected -2 -> -2.0000001 in the WAT was invisible, because this
    // box's near/far make that difference vanish when the result is rounded
    // to f32. GL maps near to -1 and far to +1, and a z row that is wrong by
    // any visible amount fails here whatever the reference says.
    // glOrtho's near and far are DISTANCES along -z, so the near plane is the
    // eye-space point z = -near, not z = +near. With this call's near = -1 the
    // near plane is therefore at z = +1. Writing the two literally the first
    // time asserted the exact opposite of GL and failed against correct WAT.
    const nearZ = transform(top(), 0, 0, -(-1))[2];
    const farZ = transform(top(), 0, 0, -(1))[2];
    assert.ok(Math.abs(nearZ + 1) < 1e-6,
      `ortho maps the near plane to -1, got ${nearZ}`);
    assert.ok(Math.abs(farZ - 1) < 1e-6,
      `ortho maps the far plane to +1, got ${farZ}`);
  }

  // The same for frustum: a point on the near plane lands on -1, one on the
  // far plane on +1, after the perspective divide.
  e.gl_mtx_load_identity();
  e.gl_mtx_frustum(-1, 1, -0.75, 0.75, 0.1, 4096);
  {
    const near = transform(top(), 0, 0, -0.1);
    const far = transform(top(), 0, 0, -4096);
    assert.ok(Math.abs(near[2] + 1) < 1e-5,
      `frustum maps the near plane to -1, got ${near[2]}`);
    assert.ok(Math.abs(far[2] - 1) < 1e-5,
      `frustum maps the far plane to +1, got ${far[2]}`);
  }

  // load/mult through the staging slot, the entry points the encoder will use.
  {
    const staging = e.gl_mtx_staging_ptr() >>> 0;
    const view = new Float32Array(memory.buffer, staging, 16);
    const m = scale(5, 6, 7);
    view.set(m);
    e.gl_mtx_load_identity();
    e.gl_mtx_load_src();
    compare('load_src installs the staged matrix', top(), m);
    view.set(translation(1, 1, 1));
    e.gl_mtx_mult_src();
    compare('mult_src post-multiplies the staged matrix', top(),
      multiply(m, translation(1, 1, 1)));
  }

  // Stack limits. GL raises rather than growing, and refuses to empty a stack.
  e.gl_mtx_clear_error();
  assert.strictEqual(e.gl_mtx_error(), 0, 'no error latched so far');
  e.gl_mtx_set_mode(PROJECTION);
  while (e.gl_mtx_depth(1) > 0) e.gl_mtx_pop();
  e.gl_mtx_pop();
  assert.strictEqual(e.gl_mtx_error(), GL_STACK_UNDERFLOW,
    'popping a one-deep stack raises GL_STACK_UNDERFLOW');
  assert.strictEqual(e.gl_mtx_depth(1), 0, 'and leaves the stack one deep');
  e.gl_mtx_clear_error();
  e.gl_mtx_load_identity();
  e.gl_mtx_translate(1, 2, 3);
  const marker = top();
  for (let i = 0; i < 31; i++) e.gl_mtx_push();
  assert.strictEqual(e.gl_mtx_depth(1), 31, 'the stack holds 32 entries');
  assert.strictEqual(e.gl_mtx_error(), 0, 'filling the stack is not an error');
  e.gl_mtx_push();
  assert.strictEqual(e.gl_mtx_error(), GL_STACK_OVERFLOW,
    'pushing past 32 entries raises GL_STACK_OVERFLOW');
  assert.strictEqual(e.gl_mtx_depth(1), 31, 'and does not grow the stack');
  compare('an overflowing push leaves the top untouched', top(), marker);

  // The two texture stacks are independent, which is the whole reason
  // glActiveTextureARB selects between them.
  e.gl_mtx_clear_error();
  e.gl_mtx_set_mode(TEXTURE);
  e.gl_mtx_set_active_texture(0);
  e.gl_mtx_load_identity();
  e.gl_mtx_scale(9, 9, 9);
  e.gl_mtx_set_active_texture(1);
  e.gl_mtx_load_identity();
  compare('unit 1 is identity after unit 0 was scaled', top(), identity());
  e.gl_mtx_set_active_texture(0);
  compare('unit 0 kept its own matrix', top(), scale(9, 9, 9));

  // An unrecognized mode is ignored rather than selecting a fifth stack.
  const before = e.gl_mtx_selected();
  e.gl_mtx_set_mode(0x1234);
  assert.strictEqual(e.gl_mtx_selected(), before,
    'an unknown glMatrixMode argument leaves the mode alone');

  console.log('PASS  WAT GL matrix stacks mirror lib/gl-compat.js');
})().catch(error => { console.error(error); process.exit(1); });
