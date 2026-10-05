'use strict';
// Shared pixel oracle for the browser GPU and native WAT software backends.
function glideTwoTMU(device, read, size) {
  const packet = (values) => new Uint8Array(new Uint32Array(values).buffer);
  const upload = (unit, colors) => {
    const bytes = new Uint8Array(40);
    bytes.set(packet([unit, 0, 7, 7, 3, 10, 3, 8]));
    new Uint16Array(bytes.buffer, 32).set(colors);
    device.submit(18, bytes);
  };
  const bytes = new Uint8Array(336 + 180),
    s = new Uint32Array(bytes.buffer, 0, 64);
  const second = new Uint32Array(bytes.buffer, 256, 20),
    view = new DataView(bytes.buffer);
  const values = {
    0: 3,
    1: 8,
    3: 1,
    5: 1,
    14: 4,
    16: 4,
    18: 7,
    28: size,
    29: size,
    30: 1,
    31: 1,
    33: 7,
    34: 7,
    35: 3,
    36: 10,
    37: 3,
    38: 1,
    39: 1,
    45: 1,
    46: 3,
    47: 1,
    48: 1,
    54: 2,
    61: 1
  };
  for (const [key, value] of Object.entries(values)) s[key] = value;
  second.set([0, 7, 7, 3, 10, 3, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 3; i++) {
    const xy = [
      [0, 0],
      [size, 0],
      [0, size]
    ][i];
    [...xy, 0, 255, 255, 255, 0, 255, 1, 0, 0, 1, 192, 0, 1].forEach((v, j) =>
      view.setFloat32(336 + i * 60 + j * 4, v, true)
    );
  }
  const sample = () => {
    device.submit(3, packet([0, 255, 65535]));
    device.submit(15, bytes);
    return read();
  };
  upload(0, [0xffe0, 0, 0, 0]); // Yellow at TMU0 coordinate zero.
  upload(1, [0xf800, 0x07ff, 0, 0]); // Cyan at independent TMU1 coordinate .75.
  const multiply = sample(); // yellow * cyan = green.
  upload(1, [0xf800, 0xf81f, 0, 0]);
  const isolatedUpload = sample(); // yellow * magenta = red; TMU0 stays yellow.
  s[46] = 3;
  s[47] = 8;
  s[48] = 3;
  s[49] = 8;
  s[32] = 4096;
  const passthrough = sample(); // No TMU0 source exists at this address.
  s[32] = 0;
  s[46] = 4;
  s[47] = 8;
  s[48] = 1;
  s[49] = 0;
  const saturatedAdd = sample(); // yellow + magenta saturates to white.
  s[46] = 3;
  s[47] = 1;
  upload(0, [0, 0xffe0, 0, 0]);
  upload(1, [0x07ff, 0xf81f, 0, 0]);
  for (let i = 0; i < 3; i++) {
    view.setFloat32(336 + i * 60 + 9 * 4, 96, true);
    view.setFloat32(336 + i * 60 + 11 * 4, 0.5, true);
    view.setFloat32(336 + i * 60 + 14 * 4, 2, true);
  }
  // S0/Q0=.75 selects yellow; S1/Q1=.375 selects cyan. Sharing Q0,
  // Q1 or the global Q=1 produces a different color for at least one unit.
  const distinctQ = sample();
  for (let i = 0; i < 3; i++) {
    view.setFloat32(336 + i * 60 + 11 * 4, i === 1 ? 2 : 0.25, true);
    view.setFloat32(336 + i * 60 + 14 * 4, i === 1 ? 0.5 : 2, true);
  }
  // At either suite's interior sample: interpolated S0/Q0 remains on the
  // right texel, S1/Q1 on the left. Dividing at vertices before interpolation
  // incorrectly moves TMU1 onto the magenta texel.
  const varyingQ = sample();
  // TMU1 clamps a negative (other-local)*local before inversion.
  // Deferring the clamp lets an above-one value reach TMU0 modulation.
  upload(0, [0x8410, 0x8410, 0x8410, 0x8410]);
  upload(1, [0xffff, 0xffff, 0xffff, 0xffff]);
  second[12] = 6;
  second[13] = 1;
  second[16] = 1;
  s[46] = 3;
  s[47] = 1;
  const intermediateInvert = sample();
  // Stale texture selectors/factors do not make LOCAL/ZERO equations sample
  // an uninitialized texture. Exercise RGB and alpha independently.
  s[32] = 4096;
  s[46] = 1;
  s[48] = 1;
  s[5] = 1;
  s[6] = 5;
  s[8] = 1;
  s[3] = 1;
  const inactiveTexture = [];
  for (const [fn, factor] of [[0, 4], [1, 4], [2, 5], [3, 0], [4, 0], [9, 0]]) {
    s[0] = fn;
    s[1] = factor;
    inactiveTexture.push(sample());
  }
  // Original Glide 3 Programming Guide: chroma compares RGB OTHER before
  // color combine, not the final output and not invariably the texture.
  // https://www.bitsavers.org/components/3dfx/Glide_Programming_Guide_3.0_199806.pdf
  s[0] = 1;
  s[1] = 0;
  s[20] = 1;
  s[3] = 0;
  s[21] = 0xffffff;
  const chromaIterated = sample();
  s[3] = 2;
  s[10] = 0xff0000;
  s[21] = 0xff0000;
  const chromaConstant = sample();
  s[21] = 0xffffff;
  const chromaBeforeCombine = sample();
  s[3] = 1;
  s[32] = 0;
  s[21] = 0x848284;
  const chromaTexture = sample();
  device.submit(0, packet([19, 0]));
  const completedPixel = read();
  return {
    multiply,
    isolatedUpload,
    passthrough,
    saturatedAdd,
    distinctQ,
    varyingQ,
    intermediateInvert,
    inactiveTexture,
    chromaIterated,
    chromaConstant,
    chromaBeforeCombine,
    chromaTexture,
    completedPixel
  };
}
glideTwoTMU.expected = {
  multiply: [0, 255, 0, 255],
  isolatedUpload: [255, 0, 0, 255],
  passthrough: [255, 0, 255, 255],
  saturatedAdd: [255, 255, 255, 255],
  distinctQ: [0, 255, 0, 255],
  varyingQ: [0, 255, 0, 255],
  intermediateInvert: [132, 130, 132, 255],
  inactiveTexture: [
    [0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255],
    [0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255]
  ],
  chromaIterated: [0, 0, 0, 255],
  chromaConstant: [0, 0, 0, 255],
  chromaBeforeCombine: [255, 255, 255, 255],
  chromaTexture: [0, 0, 0, 255],
  completedPixel: [0, 0, 0, 255]
};
if (typeof module !== 'undefined') module.exports = glideTwoTMU;
