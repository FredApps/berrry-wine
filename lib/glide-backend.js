// Glide 2 packet executor. API constants follow the original Glide 2.4 SDK:
// https://github.com/sezero/glide/blob/master/glide2x/sst1/glide/src/glide.h
// Packets own their state/vertices; execute in order before mutating texture RAM.
// Import ABI: glide_submit(opcode, wasmPointer, byteLength). Opcode 0 carries
// records [opcode:u32, length:u32, payload rounded to 4 bytes]; other opcodes
// carry one payload. Draws contain a 256-byte state snapshot followed by one
// or more triangles of the SDK's 60-byte GrVertex (two TMU coordinate slots).
// State word groups (kept in sync with src/09a8h-glide.wat):
//   0..4 RGB combine; 5..9 alpha combine; 10 constant color;
//   11..13 depth mode/function/mask; 14..17 RGB/alpha source/dest blend;
//   18..19 alpha test; 20..21 chroma; 22..23 fog; 24 cull; 25 origin;
//   26..29 clip bounds; 30..31 RGB/alpha masks;
//   32..37 texture address/smallLOD/largeLOD/aspect/format/evenOdd;
//   38..43 clamp S/T, min/mag filter, mip mode, float LOD bias;
//   44 signed depth bias; 45 render buffer; 46..51 TMU RGB/alpha combines;
//   52 dither; 53 float display gamma; 54..59 hints; 60 mip blend; 61 active.
// RGB targets currently retain 8-bit channels; Voodoo RGB565 quantization and
// ordered dithering are fidelity approximations. LFB conversion is exact RGB565.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlideBackend = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STATE_BYTES = 256,
    VERTEX_BYTES = 60,
    TEXTURE_BYTES = 4 * 1024 * 1024;
  function fail(reason) {
    throw new Error('Glide: ' + reason);
  }
  function need(bytes, size) {
    if (bytes.byteLength < size) fail('truncated packet');
  }
  function words(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  function color(value, format = 0) {
    const b = [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    const indices = [
      [1, 2, 3, 0],
      [3, 2, 1, 0],
      [0, 1, 2, 3],
      [2, 1, 0, 3]
    ][format];
    if (!indices) fail('color format ' + format);
    return indices.map((i) => b[i] / 255);
  }
  function dimensions(lod, aspect) {
    if (lod < 0 || lod > 8 || aspect < 0 || aspect > 6) fail('texture dimensions');
    const n = 256 >> lod;
    return [Math.max(1, n >> Math.max(0, aspect - 3)), Math.max(1, n >> Math.max(0, 3 - aspect))];
  }
  function textureLayout(small, large, aspect, format, mask) {
    if (small < large || small > 8 || large < 0 || ![1, 2, 3].includes(mask)) fail('texture LOD/mask');
    const result = [];
    let offset = 0;
    for (let lod = large; lod <= small; lod++) {
      if (!(mask & (lod & 1 ? 2 : 1))) continue;
      const [width, height] = dimensions(lod, aspect),
        size = width * height * (format < 8 ? 1 : 2);
      result.push({ lod, width, height, offset, size });
      offset += size;
    }
    return { levels: result, size: Math.max(8, (offset + 7) & ~7) };
  }
  function decodeTexture(data, format, palette) {
    const count = data.length / (format < 8 ? 1 : 2),
      out = new Uint8Array(count * 4);
    if (![0, 2, 3, 4, 5, 8, 10, 11, 12, 13, 14].includes(format)) fail('texture format ' + format);
    for (let i = 0; i < count; i++) {
      const x = format < 8 ? data[i] : data[i * 2] | (data[i * 2 + 1] << 8);
      let r = 255,
        g = 255,
        b = 255,
        a = 255;
      if (format === 0 || format === 8) {
        r = Math.round((((x >> 5) & 7) * 255) / 7);
        g = Math.round((((x >> 2) & 7) * 255) / 7);
        b = (x & 3) * 85;
        if (format === 8) a = x >> 8;
      } else if (format === 2) a = x;
      else if (format === 3) r = g = b = x;
      else if (format === 4) {
        r = g = b = (x & 15) * 17;
        a = (x >> 4) * 17;
      } else if (format === 5 || format === 14) {
        const p = palette[x & 255];
        r = (p >>> 16) & 255;
        g = (p >>> 8) & 255;
        b = p & 255;
        if (format === 14) a = x >> 8;
      } else if (format === 10) {
        r = Math.round(((x >> 11) * 255) / 31);
        g = Math.round((((x >> 5) & 63) * 255) / 63);
        b = Math.round(((x & 31) * 255) / 31);
      } else if (format === 11) {
        r = Math.round((((x >> 10) & 31) * 255) / 31);
        g = Math.round((((x >> 5) & 31) * 255) / 31);
        b = Math.round(((x & 31) * 255) / 31);
        a = x & 32768 ? 255 : 0;
      } else if (format === 12) {
        r = ((x >> 8) & 15) * 17;
        g = ((x >> 4) & 15) * 17;
        b = (x & 15) * 17;
        a = (x >> 12) * 17;
      } else if (format === 13) {
        r = g = b = x & 255;
        a = x >> 8;
      }
      out.set([r, g, b, a], i * 4);
    }
    return out;
  }
  function combine(fn, factor, local, other, invert, alpha) {
    const l = ['vColor', 'uConstant', 'vec4(vDepth)'][local],
      o = ['vColor', 'tex', 'uConstant'][other];
    if (!l || !o) fail('combine source');
    const fs = [
      'vec4(0.0)',
      l,
      `vec4(${o}.a)`,
      `vec4(${l}.a)`,
      'vec4(tex.a)',
      'tex',
      null,
      null,
      'vec4(1.0)',
      `(vec4(1.0)-${l})`,
      `vec4(1.0-${o}.a)`,
      `vec4(1.0-${l}.a)`,
      'vec4(1.0-tex.a)',
      '(vec4(1.0)-tex)'
    ][factor];
    if (!fs) fail('combine factor ' + factor);
    const f = alpha ? `(${fs}).a` : `(${fs}).rgb`,
      lc = alpha ? `${l}.a` : `${l}.rgb`,
      oc = alpha ? `${o}.a` : `${o}.rgb`,
      la = alpha ? `${l}.a` : `vec3(${l}.a)`,
      zero = alpha ? '0.0' : 'vec3(0.0)',
      one = alpha ? '1.0' : 'vec3(1.0)';
    const e = {
      0: zero,
      1: lc,
      2: la,
      3: `${f}*${oc}`,
      4: `${f}*${oc}+${lc}`,
      5: `${f}*${oc}+${la}`,
      6: `${f}*(${oc}-${lc})`,
      7: `${f}*(${oc}-${lc})+${lc}`,
      8: `${f}*(${oc}-${lc})+${la}`,
      9: `${f}*(-${lc})+${lc}`,
      16: `${f}*(-${lc})+${la}`
    }[fn];
    if (e === undefined) fail('combine function ' + fn);
    return invert ? `(${one}-clamp(${e},${zero},${one}))` : `clamp(${e},${zero},${one})`;
  }
  const compare = ['false', 'a<b', 'a==b', 'a<=b', 'a>b', 'a!=b', 'a>=b', 'true'];
  // 12-bit mantissa, 4-bit exponent encoding of reciprocal W. Derived from
  // Voodoo's 16.32 startW iterator, shifted 16 bits during subpixel setup:
  // https://github.com/mamedev/mame/blob/master/src/devices/video/voodoo_render.cpp
  function wDepth(oow) {
    if (oow >= 1) return 0;
    if (oow <= 1 / 65536) return 65535;
    const e = Math.max(0, Math.ceil(-Math.log2(oow)) - 1);
    return Math.min(65535, e * 4096 + 8192 - Math.floor(oow * 2 ** (e + 13)));
  }
  function shaders(s) {
    if (s[11] > 2) fail('depth compare-to-bias mode ' + s[11]);
    if ((s[22] & 255) > 3 || s[22] & ~0x303) fail('fog mode ' + s[22]);
    if ([4, 5, 12, 13].includes(s[47]) || [4, 5, 12, 13].includes(s[49]))
      fail('TMU detail/LOD combine factor');
    if (!compare[s[18]]) fail('alpha comparison');
    const textured =
      s[3] === 1 || s[8] === 1 || [4, 5, 12, 13].includes(s[1]) || [4, 5, 12, 13].includes(s[6]);
    const vs = `attribute vec4 aPosition; attribute vec4 aColor; attribute vec3 aTex;attribute float aOow;
      varying vec4 vColor; varying vec3 vTex; varying float vDepth;varying float vOow;
      void main(){gl_Position=aPosition;${s[11] === 2 ? 'gl_Position.z=0.0;' : ''}gl_PointSize=1.0;vColor=aColor;vTex=aTex;vDepth=aPosition.z*0.5+0.5;vOow=aOow;}`;
    const fogMode = s[22] & 255;
    const mipmapped = textured && !!s[42];
    const fs = `${s[11] === 2 ? '#extension GL_EXT_frag_depth : require\n' : ''}${mipmapped ? '#extension GL_OES_standard_derivatives : require\n#extension GL_EXT_shader_texture_lod : require\n' : ''}precision highp float; varying vec4 vColor; varying vec3 vTex; varying float vDepth;varying float vOow;
      uniform sampler2D uTexture;uniform sampler2D uFogTable; uniform vec4 uConstant; uniform vec4 uChroma; uniform vec4 uFog; uniform float uAlpha;uniform float uDepthBias;uniform float uLodBias;uniform vec4 uTextureSize;
      float wDepth(float q){if(q>=1.0)return 0.0;if(q<=1.0/65536.0)return 65535.0;float e=max(0.0,ceil(-log2(q))-1.0);return clamp(e*4096.0+8192.0-floor(q*exp2(e+13.0)),0.0,65535.0);}
      void main(){vec2 uv=vTex.xy/vTex.z;
      ${mipmapped ? 'vec2 dx=dFdx(uv)*uTextureSize.xy;vec2 dy=dFdy(uv)*uTextureSize.xy;float lod=0.5*log2(max(max(dot(dx,dx),dot(dy,dy)),1.0e-16))+uLodBias;' : ''}
      vec4 tex=${mipmapped ? 'texture2DLodEXT(uTexture,uv,min(lod,uTextureSize.z))' : textured ? 'texture2D(uTexture,uv)' : 'vec4(1.0)'};
      ${
        textured
          ? `tex=vec4(${combine(s[46], s[47], 0, 2, s[50], false)
              .replace(/vColor/g, 'tex')
              .replace(/uConstant/g, 'vec4(0.0)')},${combine(s[48], s[49], 0, 2, s[51], true)
              .replace(/vColor/g, 'tex')
              .replace(/uConstant/g, 'vec4(0.0)')});`
          : ''
      }
      ${s[20] ? 'if(all(lessThan(abs(tex.rgb-uChroma.rgb),vec3(0.5/255.0))))discard;' : ''}
      vec4 c=vec4(${combine(...s.slice(0, 5), false)},${combine(...s.slice(5, 10), true)});
      float a=c.a;float b=uAlpha;if(!(${compare[s[18]]}))discard;
      ${
        fogMode
          ? `float fog=${fogMode === 1 ? 'clamp(vColor.a,0.0,1.0)' : fogMode === 3 ? 'clamp(vDepth,0.0,1.0)' : 'texture2D(uFogTable,vec2((clamp((wDepth(vOow)+uDepthBias)/1024.0,0.0,63.0)+0.5)/64.0,0.5)).r'};
      c.rgb=${s[22] & 256 ? 'vec3(0.0)' : 'c.rgb*(1.0-fog)'}+${s[22] & 512 ? 'vec3(0.0)' : 'uFog.rgb*fog'};`
          : ''
      }
      ${s[11] === 2 ? 'gl_FragDepthEXT=clamp((wDepth(vOow)+uDepthBias)/65535.0,0.0,1.0);' : ''}
      gl_FragColor=c;}`;
    return { vs, fs, textured, mipmapped };
  }
  class Device {
    constructor(options) {
      this.options = options;
      this.backend = options.backend;
      this.stats = {
        draws: 0,
        triangles: 0,
        presents: 0,
        swaps: 0,
        uploads: 0,
        uploadBytes: 0,
        shaderVariants: 0,
        lfbReads: 0,
        lfbWrites: 0,
        errors: 0,
        mergedDraws: 0
      };
      this.opened = false;
      this.programs = new Map();
      this.textures = new Map();
      this.ram = new Uint8Array(TEXTURE_BYTES);
      this.ranges = [];
      this.palette = new Uint32Array(256);
    }
    submit(op, bytes) {
      try {
        const result = this.execute(op, bytes);
        // Front writes become visible at a batch/barrier boundary. The
        // recursive batch executor deliberately does not publish per draw.
        if (this.opened && this.frontDirty && this.active) this.present();
        return result;
      } catch (error) {
        this.stats.errors++;
        throw error;
      }
    }
    execute(op, bytes) {
      if (op === 0) {
        let at = 0;
        const v = words(bytes);
        while (at < bytes.length) {
          need(bytes.subarray(at), 8);
          const cmd = v.getUint32(at, true),
            n = v.getUint32(at + 4, true);
          if (cmd === 0 || n > bytes.length - at - 8) fail('invalid batch record');
          let payload = bytes.subarray(at + 8, at + 8 + n);
          at += 8 + ((n + 3) & ~3);
          if (cmd === 5 && n >= 436) {
            const draws = [payload];
            let size = n;
            while (at + 8 <= bytes.length && v.getUint32(at, true) === 5) {
              const length = v.getUint32(at + 4, true);
              if (length < 436 || length > bytes.length - at - 8) break;
              let equal = true;
              for (let j = 0; j < 256; j++)
                if (bytes[at + 8 + j] !== payload[j]) {
                  equal = false;
                  break;
                }
              if (!equal) break;
              draws.push(bytes.subarray(at + 8, at + 8 + length));
              size += length - 256;
              at += 8 + ((length + 3) & ~3);
            }
            if (draws.length > 1) {
              const merged = new Uint8Array(size);
              merged.set(payload);
              let offset = payload.length;
              for (let i = 1; i < draws.length; i++) {
                merged.set(draws[i].subarray(256), offset);
                offset += draws[i].length - 256;
              }
              payload = merged;
              this.stats.mergedDraws += draws.length - 1;
            }
          }
          this.execute(cmd, payload);
        }
        if (at !== bytes.length) fail('batch alignment');
        return 1;
      }
      const v = words(bytes),
        u = (i) => v.getUint32(i * 4, true);
      if (op === 1) {
        need(bytes, 20);
        if (!this.backend) fail('a GPU backend is required');
        this.close();
        this.hwnd = u(0);
        this.width = u(1);
        this.height = u(2);
        this.colorFormat = u(3);
        this.origin = u(4);
        if (!this.width || !this.height || this.width > 2048 || this.height > 2048)
          fail('drawable dimensions');
        this.backend.canvas.width = this.width;
        this.backend.canvas.height = this.height;
        this.buffer = this.backend.createBuffer();
        this.colorIds = [Symbol('Glide front'), Symbol('Glide back')];
        this.depthId = Symbol('Glide aux');
        for (const id of this.colorIds)
          this.backend.createColorResource(
            id,
            this.width,
            this.height,
            new Uint8Array(this.width * this.height * 4)
          );
        this.boundId = null;
        this.gamma = 1;
        this.active = true;
        this.frontDirty = false;
        this.opened = true;
        this.bind(1);
        return 1;
      }
      if (op === 2) {
        this.close();
        return 1;
      }
      if (!this.opened) fail('context is closed');
      const b = this.backend,
        g = b.gl;
      if (op === 3) {
        need(bytes, 12);
        const snapshot = bytes.length >= 268,
          offset = snapshot ? 64 : 0;
        this.bind(snapshot ? u(45) : 1);
        if (snapshot) {
          this.active = !!u(61);
          b.setCapability(g.SCISSOR_TEST, true);
          b.setScissor(
            u(26),
            u(25) ? u(27) : this.height - u(29),
            Math.max(0, u(28) - u(26)),
            Math.max(0, u(29) - u(27))
          );
        } else b.setCapability(g.SCISSOR_TEST, false);
        b.setDepthMask(snapshot ? !!u(13) : true);
        g.colorMask(
          snapshot ? !!u(30) : true,
          snapshot ? !!u(30) : true,
          snapshot ? !!u(30) : true,
          snapshot ? !!u(31) : true
        );
        g.clearDepth(u(offset + 2) / 65535);
        const c = color(u(offset), this.colorFormat);
        c[3] = (u(offset + 1) & 255) / 255;
        b.clear(c, g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
        if (snapshot && u(45) === 0) this.frontDirty = true;
        return 1;
      }
      if (op === 4) {
        if (bytes.length >= 256) {
          this.gamma = v.getFloat32(53 * 4, true);
          this.active = !!u(61);
        }
        this.colorIds.reverse();
        this.stats.swaps++;
        this.frontDirty = true;
        if (this.active) this.present();
        return 1;
      }
      if (op === 5) {
        this.draw(bytes);
        return 1;
      }
      if (op === 11 || op === 12) {
        this.draw(bytes, op === 11 ? 2 : 1);
        return 1;
      }
      if (op === 6) {
        need(bytes, 28);
        const address = u(0),
          layout = textureLayout(u(1), u(2), u(3), u(4), u(5)),
          length = u(6);
        if (length < layout.levels.reduce((n, l) => n + l.size, 0) || length > TEXTURE_BYTES - address)
          fail('texture upload bounds');
        need(bytes, 28 + length);
        this.ram.set(bytes.subarray(28, 28 + length), address);
        // Track initialized address coverage, not upload history. Replacing a
        // texture each frame must not retain one interval object per frame.
        const coverage = this.ranges.concat([[address, address + length]]).sort((a, b) => a[0] - b[0]);
        this.ranges = [];
        for (const range of coverage) {
          const previous = this.ranges[this.ranges.length - 1];
          if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
          else this.ranges.push(range);
        }
        for (const [key, t] of this.textures) {
          if (address < t.end && address + length > t.start) {
            b.deleteTexture(t.handle);
            this.textures.delete(key);
          }
        }
        this.stats.uploads++;
        this.stats.uploadBytes += length;
        return 1;
      }
      if (op === 7) {
        need(bytes, 1024);
        for (let i = 0; i < 256; i++) this.palette[i] = u(i);
        for (const t of this.textures.values()) b.deleteTexture(t.handle);
        this.textures.clear();
        return 1;
      }
      if (op === 8) {
        need(bytes, 64);
        this.fogTable = bytes.slice(0, 64);
        if (!this.fogTexture) this.fogTexture = b.createTexture();
        const rgba = new Uint8Array(256);
        for (let i = 0; i < 64; i++) rgba.set([bytes[i], bytes[i], bytes[i], 255], i * 4);
        b.uploadTexture2D(this.fogTexture, {
          width: 64,
          height: 1,
          internalFormat: g.RGBA,
          format: g.RGBA,
          type: g.UNSIGNED_BYTE,
          pixels: rgba
        });
        b.setTextureParameter(this.fogTexture, g.TEXTURE_MIN_FILTER, g.LINEAR);
        b.setTextureParameter(this.fogTexture, g.TEXTURE_MAG_FILTER, g.LINEAR);
        b.setTextureParameter(this.fogTexture, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        b.setTextureParameter(this.fogTexture, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        return 1;
      }
      if (op === 9 || op === 10) {
        need(bytes, 20);
        if (u(0) > 1 || u(1) > 1 || u(2) !== 0 || u(3) !== this.width || u(4) !== this.height)
          fail('LFB supports color buffer RGB565 at drawable dimensions');
        this.bind(u(0));
        need(bytes, 20 + this.width * this.height * 2);
        const pixels = new Uint8Array(this.width * this.height * 4);
        if (op === 9) {
          b.readPixels(0, 0, this.width, this.height, g.RGBA, g.UNSIGNED_BYTE, pixels);
          for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++) {
              const p = ((u(1) ? y : this.height - 1 - y) * this.width + x) * 4;
              v.setUint16(
                20 + (y * this.width + x) * 2,
                ((pixels[p] >> 3) << 11) | ((pixels[p + 1] >> 2) << 5) | (pixels[p + 2] >> 3),
                true
              );
            }
          this.stats.lfbReads++;
        } else {
          for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++) {
              const z = v.getUint16(20 + (y * this.width + x) * 2, true),
                p = ((u(1) ? y : this.height - 1 - y) * this.width + x) * 4;
              pixels[p] = Math.round(((z >> 11) * 255) / 31);
              pixels[p + 1] = Math.round((((z >> 5) & 63) * 255) / 63);
              pixels[p + 2] = Math.round(((z & 31) * 255) / 31);
              pixels[p + 3] = 255;
            }
          b.updateColorResource(this.colorIds[u(0)], pixels);
          this.boundId = null;
          this.bind(u(0));
          this.stats.lfbWrites++;
          if (u(0) === 0) this.frontDirty = true;
        }
        return 1;
      }
      fail('packet opcode ' + op);
    }
    bind(index) {
      if (index > 1) fail('aux color rendering unsupported');
      const id = this.colorIds[index];
      if (this.boundId !== id) {
        this.backend.bindColorResource(id, {
          key: this.depthId,
          width: this.width,
          height: this.height,
          bits: 16
        });
        this.boundId = id;
      }
    }
    present() {
      const b = this.backend,
        g = b.gl;
      this.bind(0);
      b.bindImplicitTarget();
      this.boundId = null;
      if (!this.presentProgram) {
        this.presentProgram = b.createProgram(
          'attribute vec2 p;varying vec2 uv;void main(){gl_Position=vec4(p,0.,1.);uv=p*.5+.5;}',
          'precision highp float;varying vec2 uv;uniform sampler2D image;uniform float gamma;void main(){gl_FragColor=vec4(pow(texture2D(image,uv).rgb,vec3(1.0/gamma)),1.0);}',
          ['p'],
          ['image', 'gamma']
        );
        this.presentBuffer = b.createBuffer();
        b.updateBuffer(this.presentBuffer, g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
      }
      for (const cap of [g.DEPTH_TEST, g.STENCIL_TEST, g.BLEND, g.CULL_FACE, g.SCISSOR_TEST])
        b.setCapability(cap, false);
      g.colorMask(true, true, true, true);
      b.setViewport(0, 0, this.width, this.height);
      b.bindTexture(b._colorResources.get(this.colorIds[0]).color, 0);
      b.setUniform(this.presentProgram, 'image', '1i', 0);
      b.setUniform(this.presentProgram, 'gamma', '1f', this.gamma > 0 ? this.gamma : 1);
      b.draw({
        program: this.presentProgram,
        vertexBuffer: this.presentBuffer,
        stride: 8,
        attributes: [{ name: 'p', size: 2, offset: 0 }],
        mode: g.TRIANGLE_STRIP,
        count: 4
      });
      this.stats.presents++;
      this.frontDirty = false;
      const surface = b.present();
      // RasterCanvas lazily captures the currently bound GL framebuffer. Make
      // its presentation snapshot while the default drawable is still bound.
      // Browser presentationCanvas already copies on the GPU and skips this.
      if (surface && typeof surface.markGlPresented === 'function') void surface._data;
      if (this.options.onPresent)
        this.options.onPresent({
          surface,
          hwnd: this.hwnd,
          width: this.width,
          height: this.height,
          stats: this.stats
        });
      this.bind(1);
    }
    texture(s) {
      const key = Array.from(s.slice(32, 38)).join('/');
      let t = this.textures.get(key);
      if (t) return t;
      const b = this.backend,
        g = b.gl,
        start = s[32],
        layout = textureLayout(s[33], s[34], s[35], s[36], s[37]);
      if (!layout.levels.length) fail('empty texture');
      const end = start + layout.levels.reduce((n, l) => n + l.size, 0);
      if (end > TEXTURE_BYTES || !this.ranges.some((r) => r[0] <= start && r[1] >= end))
        fail('texture source not uploaded');
      if (s[37] !== 3) fail('split even/odd mip chains need a second TMU');
      const handle = b.createTexture();
      for (let i = 0; i < layout.levels.length; i++) {
        const l = layout.levels[i];
        b.uploadTexture2D(handle, {
          level: i,
          width: l.width,
          height: l.height,
          internalFormat: g.RGBA,
          format: g.RGBA,
          type: g.UNSIGNED_BYTE,
          pixels: decodeTexture(
            this.ram.subarray(start + l.offset, start + l.offset + l.size),
            s[36],
            this.palette
          )
        });
      }
      // Glide allows the mip chain to stop before 1x1. WebGL1 nevertheless
      // requires complete storage for a mipmapped sampler. These unreachable
      // tail levels complete storage; the shader clamps LOD to the last real
      // uploaded level, preserving its spatial samples under minification.
      for (let lod = s[33] + 1; lod <= 8; lod++) {
        const [width, height] = dimensions(lod, s[35]);
        b.uploadTexture2D(handle, {
          level: lod - s[34],
          width,
          height,
          internalFormat: g.RGBA,
          format: g.RGBA,
          type: g.UNSIGNED_BYTE,
          pixels: new Uint8Array(width * height * 4)
        });
      }
      t = {
        handle,
        start,
        end,
        width: layout.levels[0].width,
        height: layout.levels[0].height,
        maxLevel: s[33] - s[34]
      };
      this.textures.set(key, t);
      return t;
    }
    draw(bytes, primitiveSize = 3) {
      need(bytes, STATE_BYTES + primitiveSize * VERTEX_BYTES);
      if ((bytes.length - STATE_BYTES) % (primitiveSize * VERTEX_BYTES)) fail('primitive packet length');
      const count = (bytes.length - STATE_BYTES) / VERTEX_BYTES,
        dv = words(bytes),
        s = Array.from({ length: 64 }, (_, i) => dv.getUint32(i * 4, true));
      this.lastDrawState = s;
      this.active = !!s[61];
      this.bind(s[45]);
      this.gamma = dv.getFloat32(53 * 4, true) || 1;
      const b = this.backend,
        g = b.gl,
        source = shaders(s),
        key = source.fs;
      // The Node GPU bridge exposes desktop GLSL 1.10. Fragment depth is
      // already core there; the WebGL extension directive is invalid.
      if (g.__wineIsES === undefined)
        g.__wineIsES = /ES|WebGL/.test(String(g.getParameter(g.SHADING_LANGUAGE_VERSION) || ''));
      if (g.__wineIsES === false)
        source.fs = source.fs
          .replace(/^#extension GL_EXT_frag_depth : require\n/, '')
          .replace(/gl_FragDepthEXT/g, 'gl_FragDepth')
          .replace(
            /#extension GL_EXT_shader_texture_lod : require/g,
            '#extension GL_ARB_shader_texture_lod : require'
          )
          .replace(/texture2DLodEXT/g, 'texture2DLod');
      if (s[11] === 2 && b.version !== 2 && !g.getExtension('EXT_frag_depth'))
        fail('W buffering requires EXT_frag_depth');
      if (
        source.mipmapped &&
        b.version !== 2 &&
        g.__wineIsES &&
        (!g.getExtension('OES_standard_derivatives') || !g.getExtension('EXT_shader_texture_lod'))
      )
        fail('Glide mipmap clamping requires derivatives and explicit texture LOD');
      let program = this.programs.get(key);
      if (!program) {
        program = b.createProgram(
          source.vs,
          source.fs,
          ['aPosition', 'aColor', 'aTex', 'aOow'],
          [
            'uTexture',
            'uFogTable',
            'uConstant',
            'uChroma',
            'uFog',
            'uAlpha',
            'uDepthBias',
            'uLodBias',
            'uTextureSize'
          ]
        );
        this.programs.set(key, program);
        this.stats.shaderVariants++;
      }
      b.setViewport(0, 0, this.width, this.height);
      b.setCapability(g.SCISSOR_TEST, true);
      b.setScissor(
        s[26],
        s[25] ? s[27] : this.height - s[29],
        Math.max(0, s[28] - s[26]),
        Math.max(0, s[29] - s[27])
      );
      b.setCapability(g.DEPTH_TEST, !!s[11]);
      b.setDepthFunc(g.NEVER + s[12]);
      b.setDepthMask(!!s[13]);
      g.colorMask(!!s[30], !!s[30], !!s[30], !!s[31]);
      const blend = (n, src) => {
        const values = [
          g.ZERO,
          g.SRC_ALPHA,
          src ? g.DST_COLOR : g.SRC_COLOR,
          g.DST_ALPHA,
          g.ONE,
          g.ONE_MINUS_SRC_ALPHA,
          src ? g.ONE_MINUS_DST_COLOR : g.ONE_MINUS_SRC_COLOR,
          g.ONE_MINUS_DST_ALPHA
        ];
        if (n === 15 && src) return g.SRC_ALPHA_SATURATE;
        if (values[n] === undefined) fail('blend factor ' + n);
        return values[n];
      };
      b.setCapability(g.BLEND, true);
      g.blendFuncSeparate(blend(s[14], true), blend(s[15], false), blend(s[16], true), blend(s[17], false));
      b.setCapability(g.CULL_FACE, !!s[24]);
      b.setFrontFace(s[25] ? g.CCW : g.CW);
      b.setCullFace(s[24] === 1 ? g.BACK : g.FRONT);
      let t;
      if (source.textured) {
        t = this.texture(s);
        b.bindTexture(t.handle, 0);
        b.setTextureParameter(t.handle, g.TEXTURE_WRAP_S, s[38] ? g.CLAMP_TO_EDGE : g.REPEAT);
        b.setTextureParameter(t.handle, g.TEXTURE_WRAP_T, s[39] ? g.CLAMP_TO_EDGE : g.REPEAT);
        b.setUniform(program, 'uTextureSize', '4f', [t.width, t.height, t.maxLevel, 0]);
        b.setTextureParameter(
          t.handle,
          g.TEXTURE_MIN_FILTER,
          s[42]
            ? s[40]
              ? s[60]
                ? g.LINEAR_MIPMAP_LINEAR
                : g.LINEAR_MIPMAP_NEAREST
              : s[60]
                ? g.NEAREST_MIPMAP_LINEAR
                : g.NEAREST_MIPMAP_NEAREST
            : s[40]
              ? g.LINEAR
              : g.NEAREST
        );
        b.setTextureParameter(t.handle, g.TEXTURE_MAG_FILTER, s[41] ? g.LINEAR : g.NEAREST);
      }
      b.setUniform(program, 'uTexture', '1i', 0);
      b.setUniform(program, 'uConstant', '4f', color(s[10], this.colorFormat));
      b.setUniform(program, 'uChroma', '4f', color(s[21], this.colorFormat));
      b.setUniform(program, 'uFog', '4f', color(s[23], this.colorFormat));
      b.setUniform(program, 'uAlpha', '1f', (s[19] & 255) / 255);
      b.setUniform(program, 'uLodBias', '1f', dv.getFloat32(43 * 4, true));
      b.setUniform(program, 'uDepthBias', '1f', (s[44] << 16) >> 16);
      if ((s[22] & 255) === 2) {
        if (!this.fogTexture) fail('fog table not uploaded');
        b.bindTexture(this.fogTexture, 1);
        b.setUniform(program, 'uFogTable', '1i', 1);
      }
      const out = new Float32Array(count * 12),
        scale = dimensions(0, s[35] || 0);
      for (let i = 0; i < count; i++) {
        const p = STATE_BYTES + i * VERTEX_BYTES,
          f = (j) => dv.getFloat32(p + j * 4, true),
          at = i * 12;
        // W buffering consumes oow, not ooz. Games may leave unused ooz as
        // NaN; it must never poison clip coordinates. Keep it only for a
        // fog/combiner that explicitly consumes Z. The vertex shader keeps
        // that varying separate from W mode's neutral clip-space Z.
        const needsZ = s[11] !== 2 || (s[22] & 255) === 3 || s[2] === 2 || s[7] === 2;
        const depth = needsZ
          ? Math.min(1, Math.max(0, (f(6) + ((s[44] << 16) >> 16)) / 65535))
          : 0;
        out.set(
          [
            (f(0) * 2) / this.width - 1,
            (s[25] ? 1 : -1) * ((f(1) * 2) / this.height - 1),
            depth * 2 - 1,
            1,
            f(3) / 255,
            f(4) / 255,
            f(5) / 255,
            f(7) / 255,
            f(9) / scale[0],
            f(10) / scale[1],
            s[54] & 2 ? f(11) : f(8),
            f(8)
          ],
          at
        );
      }
      b.updateBuffer(this.buffer, g.ARRAY_BUFFER, out, g.STREAM_DRAW);
      b.draw({
        program,
        vertexBuffer: this.buffer,
        stride: 48,
        attributes: [
          { name: 'aPosition', size: 4, offset: 0 },
          { name: 'aColor', size: 4, offset: 16 },
          { name: 'aTex', size: 3, offset: 32 },
          { name: 'aOow', size: 1, offset: 44 }
        ],
        mode: primitiveSize === 3 ? g.TRIANGLES : primitiveSize === 2 ? g.LINES : g.POINTS,
        count
      });
      this.stats.draws++;
      if (s[45] === 0) this.frontDirty = true;
      if (primitiveSize === 3) this.stats.triangles += count / 3;
      else
        this.stats[primitiveSize === 2 ? 'lines' : 'points'] =
          (this.stats[primitiveSize === 2 ? 'lines' : 'points'] || 0) + count / primitiveSize;
    }
    close() {
      if (this.backend) {
        for (const t of this.textures.values()) this.backend.deleteTexture(t.handle);
        if (this.fogTexture) this.backend.deleteTexture(this.fogTexture);
        if (this.presentProgram) this.programs.set('present', this.presentProgram);
        for (const p of this.programs.values()) {
          this.backend.gl.deleteProgram(p.handle);
          this.backend._programs.delete(p.handle);
        }
        if (this.buffer) this.backend.deleteBuffer(this.buffer);
        if (this.presentBuffer) this.backend.deleteBuffer(this.presentBuffer);
        if (this.colorIds) for (const id of this.colorIds) this.backend.releaseColorResource(id);
        if (this.depthId) this.backend.releaseRenderTarget(this.depthId);
      }
      this.textures.clear();
      this.programs.clear();
      this.ranges = [];
      this.colorIds = null;
      this.depthId = null;
      this.presentProgram = null;
      this.presentBuffer = null;
      this.fogTexture = null;
      this.buffer = null;
      this.opened = false;
    }
    destroy() {
      this.close();
    }
  }
  return {
    Device,
    STATE_BYTES,
    VERTEX_BYTES,
    TEXTURE_BYTES,
    textureLayout,
    dimensions,
    decodeTexture,
    color,
    shaders,
    wDepth
  };
});
