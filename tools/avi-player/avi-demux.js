// AVI demuxer and PCM unpacking for the player and verify tool.
//
// Container walking only: every video decoder lives in
// src/09a7e-video-codecs.wat and reaches JS through ./codecs-wasm.js, so
// the pixels here and the pixels the emulator's ICM layer produces come
// from one implementation.
(function (root) {
  'use strict';

  const fcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const s32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

  // RIFF 'AVI ' { LIST 'hdrl' { avih, LIST 'strl' { strh, strf, [strn] }... },
  //               LIST 'movi' { '##dc' '##db' '##wb' '##pc' | LIST 'rec ' {...} },
  //               [idx1] }  followed by optional RIFF 'AVIX' (OpenDML) extents.
  // Every chunk is padded to an even size.
  function parseAvi(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (fcc(b, 0) !== 'RIFF' || fcc(b, 8) !== 'AVI ') throw new Error('not a RIFF AVI file');
    const out = { avih: null, streams: [], idx1: null, moviBase: -1 };
    let cur = null;

    function strh(o) {
      return {
        type: fcc(b, o), handler: fcc(b, o + 4), flags: u32(b, o + 8),
        scale: u32(b, o + 20), rate: u32(b, o + 24), start: u32(b, o + 28),
        length: u32(b, o + 32), sampleSize: u32(b, o + 44),
      };
    }
    function strf(o, size, type) {
      if (type === 'vids') {
        const bi = {
          size: u32(b, o), width: s32(b, o + 4), height: s32(b, o + 8),
          bitCount: u16(b, o + 14), compression: u32(b, o + 16),
          compressionFcc: fcc(b, o + 16), clrUsed: u32(b, o + 32),
        };
        // The colour table exactly as the file stores it: RGBQUADs, which is
        // the palette layout the WAT decoders take.
        const n = bi.bitCount <= 8 ? (bi.clrUsed || (1 << bi.bitCount)) : 0;
        const avail = Math.max(0, Math.min(n, 256, Math.floor((size - bi.size) / 4)));
        bi.palette = new Uint8Array(256 * 4);
        bi.palette.set(b.subarray(o + bi.size, o + bi.size + avail * 4));
        return bi;
      }
      if (type === 'auds') {
        return {
          formatTag: u16(b, o), channels: u16(b, o + 2), rate: u32(b, o + 4),
          avgBytes: u32(b, o + 8), blockAlign: u16(b, o + 12), bits: u16(b, o + 14),
        };
      }
      return { raw: b.subarray(o, o + size) };
    }

    function walk(off, end, inMovi) {
      while (off + 8 <= end) {
        const id = fcc(b, off), size = u32(b, off + 4), data = off + 8;
        const next = data + size + (size & 1);
        if (id === 'LIST' || id === 'RIFF') {
          const kind = fcc(b, data);
          if (kind === 'strl') { cur = { chunks: [] }; out.streams.push(cur); }
          if (kind === 'movi' && out.moviBase < 0) out.moviBase = data;
          walk(data + 4, Math.min(data + size, b.length), inMovi || kind === 'movi');
        } else if (id === 'avih') {
          out.avih = { usPerFrame: u32(b, data), totalFrames: u32(b, data + 16),
            streams: u32(b, data + 24), width: u32(b, data + 32), height: u32(b, data + 36) };
        } else if (id === 'strh' && cur) {
          cur.header = strh(data);
        } else if (id === 'strf' && cur) {
          cur.format = strf(data, size, cur.header && cur.header.type);
        } else if (id === 'strn' && cur) {
          let s = ''; for (let i = 0; i < size && b[data + i]; i++) s += String.fromCharCode(b[data + i]);
          cur.name = s;
        } else if (id === 'idx1') {
          out.idx1 = { off: data, count: Math.floor(size / 16) };
        } else if (inMovi && /^[0-9]{2}[a-z]{2}$/.test(id)) {
          const s = out.streams[+id.slice(0, 2)];
          if (s) s.chunks.push({ off: data, size: Math.min(size, b.length - data), kind: id.slice(2) });
        }
        off = next;
      }
    }
    walk(12, b.length, false);
    // RIFF 'AVIX' extents follow the first RIFF; walk() above already saw
    // them only if they sat inside its size, so scan the tail explicitly.
    let tail = 8 + u32(b, 4); tail += tail & 1;
    while (tail + 12 <= b.length && fcc(b, tail) === 'RIFF') {
      const size = u32(b, tail + 4);
      walk(tail + 12, Math.min(tail + 8 + size, b.length), fcc(b, tail + 8) === 'AVIX');
      tail += 8 + size + (size & 1);
    }

    // Keyframe flags come from idx1 (AVIIF_KEYFRAME = 0x10), matched to each
    // stream's chunks in order. Without an index only the first chunk is
    // known to be a keyframe.
    for (const s of out.streams) s.chunks.forEach((c, i) => { c.key = i === 0; });
    if (out.idx1) {
      const media = out.streams.map(s => s.chunks.filter(c => c.kind !== 'pc'));
      const seen = out.streams.map(() => 0);
      for (let i = 0; i < out.idx1.count; i++) {
        const e = out.idx1.off + i * 16, id = fcc(b, e);
        if (!/^[0-9]{2}(dc|db|wb)$/.test(id)) continue;
        const n = +id.slice(0, 2);
        if (!media[n]) continue;
        const c = media[n][seen[n]++];
        if (c) c.key = (u32(b, e + 4) & 0x10) !== 0;
      }
    }
    out.bytes = b;
    return out;
  }

  // PCM audio as per-channel Float32 arrays; other wFormatTags return null.
  function decodePcm(avi, stream) {
    const f = stream.format;
    if (!f || f.formatTag !== 1) return null;
    const b = avi.bytes, bytesPer = f.bits >> 3, ch = f.channels;
    let total = 0; for (const c of stream.chunks) if (c.kind === 'wb') total += c.size;
    const frames = Math.floor(total / (bytesPer * ch));
    const out = Array.from({ length: ch }, () => new Float32Array(frames));
    let n = 0;
    for (const c of stream.chunks) {
      if (c.kind !== 'wb') continue;
      for (let p = c.off; p + bytesPer * ch <= c.off + c.size && n < frames; n++) {
        for (let k = 0; k < ch; k++, p += bytesPer) {
          out[k][n] = bytesPer === 1 ? (b[p] - 128) / 128 : ((b[p] | (b[p + 1] << 8)) << 16 >> 16) / 32768;
        }
      }
    }
    return { rate: f.rate, channels: out };
  }


  const api = { parseAvi, decodePcm };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AviDemux = api;
})(typeof self !== 'undefined' ? self : this);
