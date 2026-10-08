'use strict';
// D3D's top-left fill rule on the GPU fixed-function path.
//
// D3D pixel centres are integer screen coordinates; GL's are half-integer, so
// the lowering adds half a pixel. With exactly half, an edge on an integer row
// lands ON the GL pixel centre and the GPU's own tie rule decides who owns it --
// and after the y flip GL sees D3D's bottom edges as top edges. NFS III draws
// its cockpit as 256x256 tiles meeting at y=256 with TEXTUREADDRESS=WRAP, so
// the upper tile also drew row 256 at tv=1.001, wrapped to its texture's opaque
// first row: a black line across the race view (WebGL; the software rasterizer
// had the same bug in its scanline walker, ce4256db). The lowering now maps D3D
// (x,y) to GL (x+0.5-e, y+0.5-e): an integer edge then owns the centre only as
// a top/left edge, on any GPU. e must survive subpixel snapping (Vulkan, and
// so SwiftShader, may keep only 4 bits: 1/128 px rounded away and the line
// stayed) and stay invisible.
const assert = require('assert');
const Fixed = require('../lib/d3d9-fixed');

const viewport = { x: 0, y: 0, width: 640, height: 480, minZ: 0, maxZ: 1 };
const draw = positionUsage => ({
  vertexShader: null, pixelShader: null, state: {}, textures: [],
  attributes: [[0, positionUsage, 0, positionUsage === 9 ? 3 : 2, 0], [5, 10, 0, 4, 16]].map(
    ([register, usage, usageIndex, type, offset]) => ({ register, usage, usageIndex, type, offset })),
  fixedFunction: { lighting: false, specular: false, fog: false, alphaTest: false, colorKey: false,
    textureFactor: 0xffffffff, stages: [{ colorOp: 1 }],
    world: identity(), view: identity(), projection: identity() },
});
function identity() { return Float32Array.from([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
const SUBPIXEL = 1 / 16, VISIBLE = 0.25;

// Pretransformed (POSITIONT): screen = (pos - vp + vec2(0.5 - e)) / vp.size.
const tl = Fixed.compile(draw(9), viewport).vertex.source;
const m = /\+ vec2\(0\.5 - ([\d.]+)\/([\d.]+)\)\) \/ d3d_ff_viewport\.zw/.exec(tl);
assert(m, `the TL mapping carries a top-left bias:\n${tl}`);
const e = Number(m[1]) / Number(m[2]);
// D3D edge at y=256 vs the GL centre of D3D row 256, both in GL window y (up).
const H = viewport.height;
const glEdge = H - (256 + 0.5 - e), glCentre = H - 256 - 0.5;
assert(glEdge - glCentre >= SUBPIXEL, `edge clears the centre by >= one 4-bit subpixel step (${glEdge - glCentre})`);
assert(glEdge - glCentre < VISIBLE, `the bias stays invisible (${glEdge - glCentre})`);
// Same on x: an integer column edge sits LEFT of that column's centre, so the
// triangle to its right owns the column.
assert(256 + 0.5 - e < 256 + 0.5 && 256 + 0.5 - (256 + 0.5 - e) >= SUBPIXEL);

// Transformed vertices: the half-pixel shift is (0.5 - e) px too.
const xf = Fixed.compile(draw(0), viewport).vertex.source;
const n = /vec2\(1\.0,-1\.0\)\*\(1\.0-([\d.]+)\/([\d.]+)\)\*gl_Position\.w\/d3d_ff_viewport\.zw/.exec(xf);
assert(n, `the transformed half-pixel shift carries the same bias:\n${xf}`);
const shiftPx = (1 - Number(n[1]) / Number(n[2])) * 0.5;
assert(Math.abs((0.5 - shiftPx) - e) < 1e-9, `transformed bias ${0.5 - shiftPx} matches TL bias ${e}`);
console.log(`PASS  D3D top-left fill rule on the GPU path: integer edges clear GL pixel centres by ${e} px`);
