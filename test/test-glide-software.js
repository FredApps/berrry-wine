'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const { Device } = require('../lib/glide-software');
const packet = (values) => new Uint8Array(new Uint32Array(values).buffer);
(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none' });
  let presents = 0,
    displayed;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData(image) {
        displayed = image.data.slice();
      }
    })
  };
  const device = new Device({
    canvas,
    getExports: () => e,
    getMemory: () => memory.buffer,
    onPresent() {
      presents++;
    }
  });
  function draw(
    rgb,
    z = 1000,
    overrides = {},
    oow = 1,
    positions = [
      [0, 0],
      [16, 0],
      [0, 16]
    ]
  ) {
    const bytes = new Uint8Array(436),
      s = new Uint32Array(bytes.buffer, 0, 64),
      v = new DataView(bytes.buffer);
    s[0] = 1;
    s[5] = 1;
    s[11] = 1;
    s[12] = 1;
    s[13] = 1;
    s[14] = 4;
    s[16] = 4;
    s[18] = 7;
    s[28] = 16;
    s[29] = 16;
    s[30] = 1;
    s[31] = 1;
    s[45] = 1;
    s[61] = 1;
    for (const [k, value] of Object.entries(overrides)) s[k] = value;
    for (let i = 0; i < 3; i++)
      positions[i]
        .concat([
          0,
          ...(Array.isArray(rgb[0]) ? rgb[i] : rgb),
          z,
          255,
          Array.isArray(oow) ? oow[i] : oow,
          0,
          0,
          1,
          0,
          0,
          1
        ])
        .forEach((x, j) => v.setFloat32(256 + i * 60 + j * 4, x, true));
    device.submit(5, bytes);
    return bytes;
  }
  const read = (x = 3, y = 3) =>
    Array.from(
      device.native.readColor(device.target(1)).pixels.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)
    );
  try {
    device.submit(1, packet([1, 16, 16, 0, 0]));
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 0, 0], 0, { 11: 0 }, 1, [
      [0, 0],
      [2.25, 0],
      [0, 2.25]
    ]);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        assert.strictEqual(read(x, y)[2], x + y <= 1 ? 255 : 0, `half-center coverage ${x},${y}`);
      }
    device.submit(3, packet([0, 255, 65535]));
    draw(
      [
        [0, 0, 0],
        [128, 0, 0],
        [0, 0, 0]
      ],
      0,
      { 11: 0 },
      1,
      [
        [0, 0],
        [4, 0],
        [0, 4]
      ]
    );
    assert(Math.abs(read(1, 1)[2] - 48) <= 1, 'half-center color interpolation evaluates x=1.5');
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 0, 0], 16384.2, { 12: 3 });
    draw([0, 255, 0], 16384.4, { 12: 3 });
    assert.deepStrictEqual(read(), [0, 255, 0, 255], 'LEQUAL compares quantized D16 values');
    draw([0, 0, 255], 16385.2, { 12: 3 });
    assert.deepStrictEqual(read(), [0, 255, 0, 255], 'D16 still rejects next farther integer');
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 0, 0], 16384.4, { 12: 1 });
    draw([0, 255, 0], 16384.2, { 12: 1 });
    assert.deepStrictEqual(read(), [0, 0, 255, 255], 'LESS rejects equal quantized D16 values');
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 0, 0]);
    assert.deepStrictEqual(read(), [0, 0, 255, 255], 'native BGRA red');
    draw([0, 255, 0], 2000);
    assert.deepStrictEqual(read(), [0, 0, 255, 255], 'far triangle rejected');
    draw([0, 0, 255], 500);
    assert.deepStrictEqual(read(), [255, 0, 0, 255], 'near triangle wins');
    device.submit(3, packet([0, 255, 65535]));
    draw([128, 64, 32], 1000, { 0: 3, 1: 8, 3: 0 });
    assert.deepStrictEqual(read(), [32, 64, 128, 255], 'scale one selects interpolated RGB');
    for (const [q, expected] of [
      [1, 0],
      [0.875, 1024],
      [0.75, 2048],
      [0.625, 3072],
      [0.5, 4096],
      [0.25, 8192],
      [0, 65535]
    ])
      assert.strictEqual(e.d3d_software_glide_w(q), expected, 'independent Voodoo W encoding');
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 0, 0], 1000, { 11: 2 }, 0.5);
    draw([0, 255, 0], 1000, { 11: 2 }, 0.25);
    assert.deepStrictEqual(read(), [0, 0, 255, 255], 'W depth rejects farther .25');
    draw([0, 0, 255], 1000, { 11: 2 }, 0.75);
    assert.deepStrictEqual(read(), [255, 0, 0, 255], 'W depth accepts nearer .75');
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 0, 0], 1000, { 11: 2, 54: 2 }, [1, 0.25, 0.25]);
    assert(
      Math.abs(
        new Float32Array(memory.buffer, device.native.depthSurfaces.get(1).wa, 16 * 16)[3 * 16 + 3] -
          2688 / 65535
      ) < 1e-6,
      'fragment W uses the global reciprocal, not the independent TMU reciprocal'
    );
    draw([0, 255, 0], 1000, { 11: 2, 54: 2 }, 0.65);
    assert.deepStrictEqual(
      read(),
      [0, 0, 255, 255],
      'W encoding follows interpolated global oow, independently of TMU oow'
    );
    const fog = new Uint8Array(64);
    fog[4] = 255;
    device.submit(8, fog);
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 0, 0], 1000, { 22: 2, 23: 0xff }, 0.5);
    assert.deepStrictEqual(read(), [255, 0, 0, 255], 'table fog at encoded W4096 selects entry4');
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 0, 0], 32767.5, { 11: 2, 22: 3, 23: 0xff }, 1);
    assert.deepStrictEqual(read(), [128, 0, 128, 255], 'iterated Z fog stays independent of W-buffer depth');
    const palette = new Uint32Array(256);
    palette[7] = 0xff0000;
    device.submit(7, new Uint8Array(palette.buffer));
    const texture = new Uint8Array(36);
    texture.set(packet([0, 8, 8, 3, 5, 3, 8]));
    texture[28] = 7;
    device.submit(6, texture);
    const textured = { 0: 3, 1: 8, 3: 1, 32: 0, 33: 8, 34: 8, 35: 3, 36: 5, 37: 3, 46: 1, 48: 1 };
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 255, 255], 1000, textured);
    assert.deepStrictEqual(read(), [0, 0, 255, 255], 'palettized texture');
    palette[7] = 0x00ff00;
    device.submit(7, new Uint8Array(palette.buffer));
    device.submit(3, packet([0, 255, 65535]));
    draw([255, 255, 255], 1000, textured);
    assert.deepStrictEqual(read(), [0, 255, 0, 255], 'palette replacement without upload');
    device.submit(3, packet([0x0000ff, 255, 65535]));
    draw([255, 255, 255], 1000, { ...textured, 20: 1, 21: 0x00ff00 });
    assert.deepStrictEqual(read(), [255, 0, 0, 255], 'matching chroma discards texel');
    const twoTexels = new Uint8Array(36);
    twoTexels.set(packet([0, 7, 7, 2, 10, 3, 8]));
    twoTexels.set([0, 248, 224, 7], 28);
    device.submit(6, twoTexels);
    const perspective = draw(
      [255, 255, 255],
      1000,
      { ...textured, 33: 7, 34: 7, 35: 2, 36: 10 },
      [1, 0.25, 0.25]
    );
    const perspectiveView = new DataView(perspective.buffer);
    perspectiveView.setFloat32(256 + 60 + 9 * 4, 64, true);
    device.submit(3, packet([0, 255, 65535]));
    device.submit(5, perspective);
    assert.deepStrictEqual(
      read(10, 2),
      [0, 0, 255, 255],
      'projected UV chooses red where affine UV would choose green'
    );
    const vertex = draw([255, 0, 0], 1000, { 11: 0 });
    device.submit(3, packet([0, 255, 65535]));
    const line = vertex.slice(0, 376),
      lineView = new DataView(line.buffer);
    lineView.setFloat32(256, 0, true);
    lineView.setFloat32(260, 3.5, true);
    lineView.setFloat32(316, 16, true);
    lineView.setFloat32(320, 3.5, true);
    device.submit(11, line);
    assert.deepStrictEqual(read(), [0, 0, 255, 255], 'native one-pixel line');
    const point = vertex.slice(0, 316),
      pointView = new DataView(point.buffer);
    pointView.setFloat32(256, 3.5, true);
    pointView.setFloat32(260, 3.5, true);
    device.submit(3, packet([0, 255, 65535]));
    device.submit(12, point);
    assert.deepStrictEqual(read(), [0, 0, 255, 255], 'native point');
    device.submit(4, new Uint8Array());
    assert.strictEqual(presents, 1);
    const lfb = new Uint8Array(20 + 16 * 16 * 2);
    lfb.set(packet([1, 0, 0, 16, 16]));
    device.submit(9, lfb);
    new DataView(lfb.buffer).setUint16(20 + (3 * 16 + 3) * 2, 0x07e0, true);
    device.submit(10, lfb);
    assert.deepStrictEqual(read(), [0, 255, 0, 255]);
    draw([64, 0, 0], 0, { 11: 0, 45: 0, 53: 0x40000000 });
    assert.strictEqual(presents, 2, 'front rendering publishes without a swap');
    assert.strictEqual(displayed[(3 * 16 + 3) * 4], 128, 'gamma applies only to display');
    assert.strictEqual(
      device.native.readColor(device.target(0)).pixels[(3 * 16 + 3) * 4 + 2],
      64,
      'front raw pixels retain pre-gamma red'
    );
    draw([0, 255, 0], 0, { 11: 0, 45: 0, 61: 0 });
    assert.strictEqual(presents, 2, 'inactive front rendering is not published');
    draw([255, 0, 0], 0, { 5: 0, 11: 0, 45: 0 });
    assert.deepStrictEqual(
      Array.from(displayed.slice((3 * 16 + 3) * 4, (3 * 16 + 3) * 4 + 4)),
      [255, 0, 0, 255],
      'RGB565 display stays opaque when rendered alpha is zero'
    );
    assert.deepStrictEqual(
      Array.from(
        device.native.readColor(device.target(0)).pixels.slice((3 * 16 + 3) * 4, (3 * 16 + 3) * 4 + 4)
      ),
      [0, 0, 255, 0],
      'display opacity does not modify raw framebuffer alpha'
    );
    const frontLfb = new Uint8Array(20 + 16 * 16 * 2);
    frontLfb.set(packet([0, 0, 0, 16, 16]));
    device.submit(9, frontLfb);
    assert.strictEqual(
      new DataView(frontLfb.buffer).getUint16(20 + (3 * 16 + 3) * 2, true),
      0xf800,
      'opaque presentation preserves raw RGB565 LFB red'
    );
    console.log(
      'PASS Glide WAT software color, Z/W depth, table fog, palette, chroma, line/point, swap and LFB'
    );
  } finally {
    device.destroy();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
