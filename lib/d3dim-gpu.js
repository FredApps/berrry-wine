// Direct3D immediate mode (DX2-DX7) on the WebGL executor.
//
// WAT keeps every D3DIM front end -- execute buffers, DrawPrimitive,
// transform and lighting -- and hands over only the post-transform work: a
// screen-space TL triangle batch (0x20000), a fence (0x20001), a readiness
// probe (0x20002), a queued flip (0x20003) and a viewport clear (0x20004).
// The software rasterizer and the render Worker answer the same records, so
// this file is one more consumer of that protocol, not a second D3D.
//
// Draws are lowered onto lib/d3d9-backend.js's fixed-function POSITIONT
// path. The state they carry comes from d3dim_gpu_describe, which reads the
// DX5-7 render state the way the software rasterizer does, so the two
// backends are asked to draw the same thing.
//
// The guest still owns a DirectDraw DIB. A render target lives on the GPU
// between fences; a fence reads it back into the DIB, and the next GPU op
// re-uploads the DIB only if something other than this executor changed it
// (a software fallback draw, a guest Lock, a Blt, a flip swapping DIBs).
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./d3d9-backend') : root.D3D9Backend);
  if (node) module.exports = api; else root.D3DIMGpu = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Backend) {
  'use strict';

  const DRAW = 0x20000, FENCE = 0x20001, READY = 0x20002, FLIP = 0x20003, CLEAR = 0x20004;
  const TL_STRIDE = 32;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ATTRIBUTES = [
    { register: 0, usage: 9, usageIndex: 0, type: 3, offset: 0 },   // x y z rhw
    { register: 5, usage: 10, usageIndex: 0, type: 4, offset: 16 }, // diffuse
    { register: 7, usage: 5, usageIndex: 0, type: 1, offset: 24 },  // tu tv
  ];
  // Vertex fog also reads the specular colour, whose alpha is the factor.
  const FOG_ATTRIBUTES = ATTRIBUTES.concat([
    { register: 6, usage: 10, usageIndex: 1, type: 4, offset: 20 },
  ]);
  // D3DTADDRESS_BORDER has no WebGL1 sampler; clamp is its nearest lowering.
  const address = mode => (mode === 4 ? 3 : mode);

  const bytesEqual = (a, b) => {
    if (a.length !== b.length) return false;
    if (typeof Buffer !== 'undefined')
      return Buffer.from(a.buffer, a.byteOffset, a.length)
        .equals(Buffer.from(b.buffer, b.byteOffset, b.length));
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  class D3DIMGpu {
    constructor(options) {
      this.getExports = options.getExports;
      this.getMemory = options.getMemory;
      this.createCanvas = options.createCanvas;
      this.onError = options.onError || (message => console.error(message));
      this.targets = new Map();   // rt entry wa -> target
      this.textures = new Map();  // texture entry wa -> cached upload
      this.textureSerial = 0;
      this.pendingReleases = [];
      this.errors = new Set();
      this.stats = {
        draws: 0, triangles: 0, lines: 0, clears: 0, textureClears: 0, declinedClears: 0, fallbacks: 0, errors: 0,
        fences: 0, syncs: 0, uploads: 0, uploadRows: 0, textureUploads: 0,
        drawMs: 0, syncMs: 0, uploadMs: 0, textureMs: 0,
      };
    }

    _view() {
      const buffer = this.getMemory();
      if (buffer !== this._buffer) {
        this._buffer = buffer;
        this.u8 = new Uint8Array(buffer);
        this.dv = new DataView(buffer);
      }
    }
    _u32(wa) { return this.dv.getUint32(wa, true); }

    call(opcode, wa) {
      opcode |= 0;
      this._view();
      if (opcode === DRAW) return this._draw(wa >>> 0);
      if (opcode === FENCE) return this.fence();
      if (opcode === READY) return 1;
      // No DIB swap is queued here: returning 0 makes the caller fence (a
      // readback) and swap synchronously, which is already in draw order.
      if (opcode === FLIP) return 0;
      if (opcode === CLEAR) return this._clear(wa >>> 0);
      return -1;
    }

    _describe(self) {
      const wa = this.getExports().d3dim_gpu_describe(self) >>> 0;
      if (!wa) return null;
      this._view();
      const f = i => this._u32(wa + i * 4);
      return {
        rt: f(0), width: f(1), height: f(2), bpp: f(3), pitch: f(4), dib: f(5), format: f(6),
        texture: f(7), texWidth: f(8), texHeight: f(9), texBpp: f(10), texPitch: f(11), texDib: f(12),
        keyed: f(13), keyRaw: f(14), palette: f(15),
        zenable: f(16), zfunc: f(17), zwrite: f(18), blend: f(19), srcblend: f(20), dstblend: f(21),
        colorOp: f(22), alphaOp: f(23), addressU: f(24), addressV: f(25), linear: f(26),
        cull: f(27), shade: f(28), alphaFunc: f(29), alphaRef: f(30),
        fog: f(31), fogColor: f(32), wrap: f(33),
      };
    }

    // A render target this executor can own: 16-bit 565/555 or 32-bit.
    _target(d) {
      if (!d.dib || !d.width || !d.height || d.width > 2048 || d.height > 2048) return null;
      if (d.bpp !== 16 && d.bpp !== 32) return null;
      let t = this.targets.get(d.rt);
      if (t && (t.width !== d.width || t.height !== d.height || t.bpp !== d.bpp)) {
        this.fence();
        this.targets.delete(d.rt);
        t = null;
      }
      if (!t) {
        const canvas = this.createCanvas(d.width, d.height);
        t = {
          rt: d.rt, width: d.width, height: d.height, bpp: d.bpp, format: d.format,
          device: new Backend.Device(canvas), dib: 0, pitch: d.pitch, shadow: null,
          dirty: false, drawn: false, check: true, textureKeys: new Set(),
        };
        this.targets.set(d.rt, t);
      }
      return t;
    }

    // Bring the GPU copy up to date with the DIB before drawing on it, unless
    // the op about to run overwrites every pixel anyway. t.shadow is what the
    // GPU holds, as DIB bytes, so only the rows the guest changed since the
    // last fence go up: MW3 locks its back buffer two or three times a frame
    // to draw a HUD strip, and a whole-frame upload per lock cost 5ms each.
    _prepare(t, d, overwritesAll) {
      if (!t.check && t.dib === d.dib) return;
      const bytes = this.u8.subarray(d.dib, d.dib + d.pitch * d.height);
      if (!overwritesAll) {
        let top = 0, bottom = t.height;
        const shadow = t.shadow;
        if (shadow && !t.dirty && shadow.length === bytes.length && t.pitch === d.pitch) {
          const rowBytes = t.width * (t.bpp >> 3), pitch = d.pitch;
          const same = y => bytesEqual(bytes.subarray(y * pitch, y * pitch + rowBytes),
            shadow.subarray(y * pitch, y * pitch + rowBytes));
          while (top < bottom && same(top)) top++;
          while (bottom > top && same(bottom - 1)) bottom--;
        }
        if (bottom > top) {
          const start = now();
          this._upload(t, bytes, d.pitch, top, bottom);
          this.stats.uploads++;
          this.stats.uploadRows += bottom - top;
          this.stats.uploadMs += now() - start;
        }
      }
      t.dib = d.dib;
      t.pitch = d.pitch;
      t.format = d.format;
      t.check = false;
    }

    // DIB rows [top, bottom) straight into the GPU colour buffer, bottom-up
    // as GL stores it, in one pass.
    _upload(t, bytes, pitch, top, bottom) {
      const { width } = t, rows = bottom - top, size = rows * width * 4;
      if (!t.upBuf || t.upBuf.length < width * t.height * 4) t.upBuf = new Uint8Array(width * t.height * 4);
      const out = t.upBuf.subarray(0, size);
      const out32 = new Uint32Array(out.buffer, out.byteOffset, rows * width);
      const rgb565 = t.format === 1, wide = t.bpp === 32;
      for (let k = 0; k < rows; k++) {
        const y = bottom - 1 - k;
        let s = y * pitch, o = k * width;
        if (wide) {
          for (let x = 0; x < width; x++, s += 4, o++)
            out32[o] = 0xff000000 | (bytes[s] << 16) | (bytes[s + 1] << 8) | bytes[s + 2];
        } else {
          for (let x = 0; x < width; x++, s += 2, o++) {
            const p = bytes[s] | (bytes[s + 1] << 8);
            let r, g, b;
            if (rgb565) { r = p >> 11; g = (p >> 5) & 63; b = p & 31; g = (g << 2) | (g >> 4); }
            else { r = (p >> 10) & 31; g = (p >> 5) & 31; b = p & 31; g = (g << 3) | (g >> 2); }
            out32[o] = 0xff000000 | (((b << 3) | (b >> 2)) << 16) | (g << 8) | ((r << 3) | (r >> 2));
          }
        }
      }
      t.device.gpu.updateColorResource(null, out, { x: 0, y: top, width, height: rows });
      // The GPU now holds these bytes; later row diffs are against them.
      if (t.shadow && t.shadow.length === bytes.length) t.shadow.set(bytes.subarray(top * pitch, bottom * pitch), top * pitch);
      else t.shadow = bytes.slice();
    }

    // GPU -> DIB for every target with draws the guest has not seen.
    fence() {
      this.stats.fences++;
      this._view();
      for (const t of this.targets.values()) {
        if (!t.dirty) continue;
        const start = now();
        const { width, height, pitch } = t, g = t.device.gpu, gl = g.gl;
        g.bindImplicitTarget();
        if (!t.readBuf || t.readBuf.length !== width * height * 4) t.readBuf = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, t.readBuf);
        const src32 = new Uint32Array(t.readBuf.buffer, 0, width * height);
        const dst = this.u8;
        const rgb565 = t.format === 1, alphaBit = t.format === 3 ? 0x8000 : 0;
        for (let y = 0; y < height; y++) {
          let s = (height - 1 - y) * width, o = t.dib + y * pitch;
          if (t.bpp === 32) {
            for (let x = 0; x < width; x++, s++, o += 4) {
              const v = src32[s];
              dst[o] = (v >>> 16) & 255; dst[o + 1] = (v >>> 8) & 255; dst[o + 2] = v & 255; dst[o + 3] = 255;
            }
          } else {
            for (let x = 0; x < width; x++, s++, o += 2) {
              const v = src32[s], r = v & 255, gr = (v >>> 8) & 255, b = (v >>> 16) & 255;
              const p = rgb565
                ? ((r >> 3) << 11) | ((gr >> 2) << 5) | (b >> 3)
                : alphaBit | ((r >> 3) << 10) | ((gr >> 3) << 5) | (b >> 3);
              dst[o] = p & 255; dst[o + 1] = p >> 8;
            }
          }
        }
        t.shadow = dst.slice(t.dib, t.dib + pitch * t.height);
        t.dirty = false;
        t.check = true;
        this.stats.syncs++;
        this.stats.syncMs += now() - start;
      }
      return 1;
    }

    _clear(wa) {
      const rt = this._u32(wa);
      const flags = this._u32(wa + 4) & 3;
      const color = this._u32(wa + 8);
      const z = this.dv.getFloat32(wa + 12, true);
      const x = this.dv.getInt32(wa + 16, true), y = this.dv.getInt32(wa + 20, true);
      const w = this.dv.getInt32(wa + 24, true), h = this.dv.getInt32(wa + 28, true);
      // A target the GPU has never drawn on stays in software: clearing it
      // here would make every software triangle after it pay a full-frame
      // readback. scr_jazz sends its D3DRM geometry down the software path
      // and spent 28 of 30 seconds in those fences, so its animation crawled.
      const owned = this.targets.get(rt);
      if (!owned || !owned.drawn) { this.stats.declinedClears++; return 0; }
      const d = {
        rt, width: this.u8[rt + 12] | (this.u8[rt + 13] << 8), height: this.u8[rt + 14] | (this.u8[rt + 15] << 8),
        bpp: this.u8[rt + 16] | (this.u8[rt + 17] << 8), pitch: this.u8[rt + 18] | (this.u8[rt + 19] << 8),
        dib: this._u32(rt + 20), format: this.getExports().d3dim_gpu_surface_fmt(rt) | 0,
      };
      const t = this._target(d);
      if (!t) { this.stats.fallbacks++; return 0; }
      const left = Math.max(0, x), top = Math.max(0, y);
      const right = Math.min(t.width, x + w), bottom = Math.min(t.height, y + h);
      // Background image (+32, describe's texture fields); keyed is always 0.
      const f = i => this._u32(wa + 32 + i * 4);
      const tex = (flags & 1) && f(0) ? {
        texture: f(0), texWidth: f(1), texHeight: f(2), texBpp: f(3), texPitch: f(4), texDib: f(5),
        keyed: 0, keyRaw: f(6), palette: f(7),
      } : null;
      if (tex && !(tex.texWidth && tex.texHeight && tex.texPitch && tex.texDib)) { this.stats.fallbacks++; return 0; }
      this._prepare(t, d, (flags & 1) && left === 0 && top === 0 && right === t.width && bottom === t.height);
      if (right <= left || bottom <= top || !flags) return 1;
      if (tex) {
        if (!this._clearTexture(t, tex, x, y, w, h)) return 0;
        this.stats.textureClears++;
        if (!(flags & 2)) return 1;
      }
      const rgba = [(color >>> 16) & 255, (color >>> 8) & 255, color & 255, color >>> 24].map(v => v / 255);
      try {
        t.device.clear(rgba, tex ? 2 : flags, Math.min(1, Math.max(0, Number.isFinite(z) ? z : 1)), [[left, top, right, bottom]]);
      } catch (error) {
        return this._fail(error);
      }
      t.dirty = true;
      this.stats.clears++;
      return 1;
    }

    _fail(error) {
      this.stats.errors++;
      if (!this.errors.has(error.message)) {
        this.errors.add(error.message);
        this.onError(`[d3dim-gpu] ${error.message}`);
      }
      return 0;
    }

    // RGBA8 texels for the bound texture, uploaded once per content change.
    _texture(t, d) {
      const size = d.texPitch * d.texHeight;
      const raw = this.u8.subarray(d.texDib, d.texDib + size);
      let cached = this.textures.get(d.texture);
      const same = cached && cached.dib === d.texDib && cached.width === d.texWidth
        && cached.height === d.texHeight && cached.bpp === d.texBpp && cached.keyed === d.keyed
        && cached.keyRaw === d.keyRaw && cached.palette === d.palette && bytesEqual(raw, cached.raw);
      if (!same) {
        const start = now();
        if (cached) this.pendingReleases.push(cached.key);
        const wa = this.getExports().d3dim_gpu_decode_texture(d.texture, d.keyed) >>> 0;
        if (!wa) return null;
        this._view();
        cached = {
          dib: d.texDib, width: d.texWidth, height: d.texHeight, bpp: d.texBpp, keyed: d.keyed,
          keyRaw: d.keyRaw, palette: d.palette, raw: this.u8.slice(d.texDib, d.texDib + size),
          pixels: this.u8.slice(wa, wa + d.texWidth * d.texHeight * 4),
          key: 'd3dim' + (++this.textureSerial),
        };
        this.textures.set(d.texture, cached);
        this.stats.textureUploads++;
        this.stats.textureMs += now() - start;
      }
      const image = { width: cached.width, height: cached.height, key: cached.key };
      if (!t.textureKeys.has(cached.key)) { image.pixels = cached.pixels; t.textureKeys.add(cached.key); }
      return image;
    }

    _draw(wa) {
      const self = this._u32(wa), primitive = this._u32(wa + 4), vertexType = this._u32(wa + 8);
      const vertices = this._u32(wa + 12), count = this._u32(wa + 16);
      // Points and strips keep the software path (its 2x2 dot has no GPU
      // twin). A line list draws the way the software line does: flat in the
      // first vertex's colour, untextured, with no depth test or blend.
      const lines = primitive === 2;
      if (vertexType !== 3 || (lines ? count < 2 : (primitive < 4 || primitive > 6 || count < 3))) {
        this.stats.fallbacks++; return 0;
      }
      const d = this._describe(self);
      if (!d) { this.stats.fallbacks++; return 0; }
      const t = this._target(d);
      if (!t) { this.stats.fallbacks++; return 0; }
      const start = now();
      this._prepare(t, d, false);
      const e = this.getExports();
      const src = e.guest_to_wasm(vertices >>> 0) >>> 0;
      this._view();
      const textured = !lines && !!(d.texture && d.texDib && d.texWidth && d.texHeight && d.texPitch);
      // D3DSHADE_FLAT takes the first vertex's colour; otherwise colour is
      // interpolated, textured or not, as the software rasterizer does.
      const flat = lines || d.shade === 1;
      const per = lines ? 2 : 3;
      const order = [];
      if (lines) for (let i = 0; i + 1 < count; i += 2) order.push(i, i + 1);
      else if (primitive === 4) for (let i = 0; i + 2 < count; i += 3) order.push(i, i + 1, i + 2);
      else if (primitive === 5) for (let i = 0; i + 2 < count; i++) order.push(...(i & 1 ? [i + 1, i, i + 2] : [i, i + 1, i + 2]));
      else for (let i = 1; i + 1 < count; i++) order.push(0, i, i + 1);
      const bytes = new Uint8Array(order.length * TL_STRIDE);
      const view = new DataView(bytes.buffer);
      // With no depth test and no depth write, sz decides nothing, and the
      // software rasterizer ignores it. The GPU still clips outside [0,1]:
      // the DX SDK Flip3DTL sample sends sz=300 with ZENABLE off, and every
      // one of its triangles vanished. Clamp it into range instead.
      const depthless = lines || (!d.zenable && !d.zwrite);
      for (let n = 0; n < order.length; n++) {
        const s = src + order[n] * TL_STRIDE, o = n * TL_STRIDE;
        bytes.set(this.u8.subarray(s, s + TL_STRIDE), o);
        if (depthless) {
          const z = view.getFloat32(o + 8, true);
          view.setFloat32(o + 8, z > 0 && z < 1 ? z : (z >= 1 ? 1 : 0), true);
        }
        // rhw 0 (pre-transformed UI) has no homogeneous w; draw it as w=1.
        // A negative rhw is a vertex behind the eye: keep it, so the GPU
        // clips the triangle as the software near-plane clipper does.
        const rhw = view.getFloat32(o + 12, true);
        if (rhw === 0 || !Number.isFinite(rhw)) view.setFloat32(o + 12, 1, true);
        const provoking = src + order[n - (n % per)] * TL_STRIDE + 16;
        const c = flat ? this._u32(provoking) : view.getUint32(o + 16, true);
        // D3DCOLOR is B,G,R,A in memory; the executor reads R,G,B,A.
        view.setUint32(o + 16, (c & 0xff00ff00) | ((c >>> 16) & 255) | ((c & 255) << 16), true);
      }
      // D3D WRAPU/WRAPV (bit 0/1): each triangle interpolates the short way
      // across the texture seam, as $d3dim_wrap_coord does on the software
      // arm. Vertices are already expanded per triangle, so moving one
      // triangle's coordinate cannot disturb a neighbour sharing that vertex.
      if (textured && d.wrap & 3) {
        for (let n = 0; n < order.length; n += 3) {
          for (const [bit, at] of [[1, 24], [2, 28]]) {
            if (!(d.wrap & bit)) continue;
            const ref = view.getFloat32(n * TL_STRIDE + at, true);
            for (let k = 1; k < 3; k++) {
              const p = (n + k) * TL_STRIDE + at, c = view.getFloat32(p, true);
              if (c - ref > 0.5) view.setFloat32(p, c - 1, true);
              else if (ref - c > 0.5) view.setFloat32(p, c + 1, true);
            }
          }
        }
      }
      const state = lines
        ? { zenable: false, zwrite: false, zfunc: 8, blend: false, srcblend: 2, dstblend: 1, cull: 1 }
        : {
          zenable: !!d.zenable, zwrite: !!d.zwrite, zfunc: d.zfunc,
          blend: !!d.blend, srcblend: d.srcblend, dstblend: d.dstblend,
          cull: d.cull === 2 || d.cull === 3 ? d.cull : 1,
        };
      // D3D5 BOTHSRCALPHA / BOTHINVSRCALPHA set both factors at once.
      if (state.srcblend === 12) { state.srcblend = 5; state.dstblend = 6; }
      if (state.srcblend === 13) { state.srcblend = 6; state.dstblend = 5; }
      const fog = !lines && !!d.fog;
      const textures = [];
      let stage;
      if (textured) {
        const image = this._texture(t, d);
        if (!image) { this.stats.fallbacks++; return 0; }
        const filter = d.linear ? 2 : 1;
        image.sampler = { addressU: address(d.addressU), addressV: address(d.addressV), mag: filter, min: filter, mip: 0 };
        textures.push(image);
        // The software combiner: SELECTARG1 = texture, SELECTARG2 = diffuse,
        // anything else modulates.
        const op = v => (v === 2 || v === 3 ? v : 4);
        stage = { colorOp: op(d.colorOp), colorArg1: 2, colorArg2: 0, alphaOp: op(d.alphaOp), alphaArg1: 2, alphaArg2: 0 };
      } else {
        stage = { colorOp: 2, colorArg1: 0, colorArg2: 0, alphaOp: 2, alphaArg1: 0, alphaArg2: 0 };
      }
      Object.assign(stage, { constant: 0xffffffff, transformFlags: 0, texCoordIndex: 0 });
      const draw = {
        primitive: lines ? 2 : 4, primitiveCount: order.length / per, stride: TL_STRIDE, vertices: bytes,
        attributes: fog ? FOG_ATTRIBUTES : ATTRIBUTES, vertexShader: null, pixelShader: null, textures, state,
        fixedFunction: {
          // Alpha test, the other way a fixed-function sprite gets its
          // transparency and the one Diablo II uses -- no colour key anywhere,
          // just ALPHAFUNC=NOTEQUAL with ALPHAREF=0 over A1R5G5B5 textures.
          // d3dim_gpu_describe publishes a bare D3DCMPFUNC, which is what the
          // fixed-function pixel shader compares in; 0 is no test at all.
          // Vertex fog only (d3dim_gpu_describe drops table fog, as the
          // software span does): a transformed vertex's specular alpha.
          lighting: false, fog, fogColor: d.fogColor, specular: false,
          alphaTest: !lines && d.alphaFunc >= 1 && d.alphaFunc <= 8,
          alphaFunc: d.alphaFunc, alphaRef: d.alphaRef,
          textureFactor: 0xffffffff,
          colorKey: textured && !!d.keyed, stages: [stage, { colorOp: 1 }],
        },
        viewport: { x: 0, y: 0, width: t.width, height: t.height, minZ: 0, maxZ: 1 },
      };
      if (!this._submit(t, draw)) return 0;
      t.drawn = true;
      this.stats.draws++;
      if (lines) this.stats.lines += order.length / 2;
      else this.stats.triangles += order.length / 3;
      this.stats.drawMs += now() - start;
      return 1;
    }

    // One draw on target t, carrying any texture releases still owed.
    _submit(t, draw) {
      if (this.pendingReleases.length) {
        draw.textureReleases = this.pendingReleases;
        this.pendingReleases = [];
        for (const target of this.targets.values())
          for (const key of draw.textureReleases) target.textureKeys.delete(key);
        // Every device must forget them, not only the one drawing now.
        for (const target of this.targets.values())
          if (target !== t) target.device.releaseTextures(draw.textureReleases);
      }
      try {
        t.device.draw(draw);
      } catch (error) {
        return this._fail(error);
      }
      t.dirty = true;
      return 1;
    }

    // A viewport background image: the texture stretched over the unclipped
    // rect [x, x+w) x [y, y+h), nearest-sampled, no blend or depth. Corners
    // sit half a pixel out so pixel (col, row) samples u = (col + 0.5) / w,
    // exactly the texel $viewport_fill_rect_texture picks.
    _clearTexture(t, tex, x, y, w, h) {
      const image = this._texture(t, tex);
      if (!image) return 0;
      image.sampler = { addressU: 3, addressV: 3, mag: 1, min: 1, mip: 0 };
      const x0 = x - 0.5, y0 = y - 0.5, x1 = x + w - 0.5, y1 = y + h - 0.5;
      const corners = [[x0, y0, 0, 0], [x1, y0, 1, 0], [x0, y1, 0, 1],
        [x1, y0, 1, 0], [x1, y1, 1, 1], [x0, y1, 0, 1]];
      const bytes = new Uint8Array(corners.length * TL_STRIDE);
      const view = new DataView(bytes.buffer);
      corners.forEach(([px, py, u, v], n) => {
        const o = n * TL_STRIDE;
        view.setFloat32(o, px, true); view.setFloat32(o + 4, py, true);
        view.setFloat32(o + 8, 0, true); view.setFloat32(o + 12, 1, true);
        view.setUint32(o + 16, 0xffffffff, true);
        view.setFloat32(o + 24, u, true); view.setFloat32(o + 28, v, true);
      });
      const stage = { colorOp: 2, colorArg1: 2, colorArg2: 0, alphaOp: 2, alphaArg1: 2, alphaArg2: 0,
        constant: 0xffffffff, transformFlags: 0, texCoordIndex: 0 };
      return this._submit(t, {
        primitive: 4, primitiveCount: 2, stride: TL_STRIDE, vertices: bytes,
        attributes: ATTRIBUTES, vertexShader: null, pixelShader: null, textures: [image],
        state: { zenable: false, zwrite: false, zfunc: 8, blend: false, srcblend: 2, dstblend: 1, cull: 1 },
        fixedFunction: {
          lighting: false, fog: false, fogColor: 0, specular: false, alphaTest: false, alphaFunc: 8, alphaRef: 0,
          textureFactor: 0xffffffff, colorKey: false, stages: [stage, { colorOp: 1 }],
        },
        viewport: { x: 0, y: 0, width: t.width, height: t.height, minZ: 0, maxZ: 1 },
      });
    }

    snapshot() { return Object.assign({}, this.stats); }
    stop() { try { this.fence(); } catch (_) {} }
  }

  return { D3DIMGpu, OPCODES: { DRAW, FENCE, READY, FLIP, CLEAR } };
});
