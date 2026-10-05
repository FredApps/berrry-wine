#!/usr/bin/env node

'use strict';

// LoadImageA(..., LR_LOADFROMFILE|LR_CREATEDIBSECTION) must produce a DIB
// section, not a DDB. The difference is observable: GetObjectA reports a
// non-NULL bmBits for a section and NULL for a DDB, and an app that asked for
// a section blits straight out of that pointer. Black & White 2 loads its
// land-picker thumbnails exactly this way and then runs `rep movsd` from
// bmBits, so a DDB here reads from address 0.

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const WIDTH = 4, HEIGHT = 2, STRIDE = WIDTH * 4;

function makeBmp() {
  const pixels = Buffer.alloc(STRIDE * HEIGHT);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    pixels[i * 4 + 0] = 0x10 + i;      // blue
    pixels[i * 4 + 1] = 0x20 + i;      // green
    pixels[i * 4 + 2] = 0x30 + i;      // red
    pixels[i * 4 + 3] = 0xFF;
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixels.length, 2);   // bfSize
  header.writeUInt32LE(54, 10);                  // bfOffBits
  header.writeUInt32LE(40, 14);                  // biSize
  header.writeInt32LE(WIDTH, 18);
  header.writeInt32LE(HEIGHT, 22);
  header.writeUInt16LE(1, 26);                   // biPlanes
  header.writeUInt16LE(32, 28);                  // biBitCount
  header.writeUInt32LE(pixels.length, 34);       // biSizeImage
  return Buffer.concat([header, pixels]);
}

function writeCString(wat, ptr, text) {
  for (let i = 0; i < text.length; i++) wat.guest_write8(ptr + i, text.charCodeAt(i));
  wat.guest_write8(ptr + text.length, 0);
}

(async () => {
  const harness = await bootRenderHarness();
  const wat = harness.exports;
  // createFilesystemImports captures ctx.vfs at import-construction time, so
  // the harness's own VFS is the one the guest sees — replacing it here would
  // populate a map nothing reads.
  const vfs = harness.hostCtx.vfs;
  vfs.files.set('c:\\land01.bmp', { data: new Uint8Array(makeBmp()), attrs: 0x20 });

  const pathGa = wat.guest_alloc(64) >>> 0;
  writeCString(wat, pathGa, 'C:\\LAND01.BMP');
  const out = wat.guest_alloc(24) >>> 0;

  const readBitmap = (handle) => {
    assert.strictEqual(wat.test_call_GetObjectA(handle, 24, out), 24,
      'GetObjectA should fill a 24-byte BITMAP');
    return {
      width: wat.guest_read32(out + 4) | 0,
      height: wat.guest_read32(out + 8) | 0,
      stride: wat.guest_read32(out + 12) | 0,
      bpp: wat.guest_read32(out + 16) >>> 16,
      bits: wat.guest_read32(out + 20) >>> 0,
    };
  };

  let passed = 0;
  const check = (name, fn) => { fn(); passed++; console.log(`PASS  ${name}`); };

  // LR_LOADFROMFILE (0x10) | LR_CREATEDIBSECTION (0x2000)
  const section = wat.test_call_LoadImageA(0, pathGa, 0, 0, 0, 0x2010) >>> 0;
  check('LR_CREATEDIBSECTION returns a bitmap', () => {
    assert.ok(section, 'LoadImageA returned NULL');
  });

  const bm = readBitmap(section);
  check('the section reports the file geometry', () => {
    assert.strictEqual(bm.width, WIDTH);
    assert.strictEqual(bm.height, HEIGHT);
    assert.strictEqual(bm.bpp, 32);
    assert.strictEqual(bm.stride, STRIDE);
  });

  check('bmBits is a real guest pointer, not NULL', () => {
    assert.notStrictEqual(bm.bits, 0,
      'GetObjectA reported bmBits=0 for a DIB section; the guest blits from here');
  });

  check('bmBits addresses the loaded pixels', () => {
    // A DIB section's bits are the file's bits, bottom-up rows and all, so the
    // first stored row is the file's first row.
    const px = wat.guest_read32(bm.bits) >>> 0;
    assert.strictEqual(px & 0xFF, 0x10, `blue channel of pixel 0 was 0x${(px & 0xFF).toString(16)}`);
    assert.strictEqual((px >>> 8) & 0xFF, 0x20);
    assert.strictEqual((px >>> 16) & 0xFF, 0x30);
  });

  // Without the flag the same file must still load, as a DDB whose private
  // storage the guest cannot address.
  const ddb = wat.test_call_LoadImageA(0, pathGa, 0, 0, 0, 0x10) >>> 0;
  check('LR_LOADFROMFILE alone still returns a DDB', () => {
    assert.ok(ddb, 'plain LR_LOADFROMFILE returned NULL');
    assert.strictEqual(readBitmap(ddb).bits, 0, 'a DDB must report bmBits=0');
  });

  // A missing file must report failure. We used to hand back a synthetic 32x32
  // bitmap, which passes a caller's handle check and then yields bmBits = 0 --
  // exactly the NULL blit Black & White 2's land loader ran into.
  const missingGa = wat.guest_alloc(64) >>> 0;
  writeCString(wat, missingGa, 'C:\\NO-SUCH-LAND.BMP');
  check('a missing file returns NULL, not a stand-in bitmap', () => {
    assert.strictEqual(wat.test_call_LoadImageA(0, missingGa, 0, 0, 0, 0x2010) >>> 0, 0);
    assert.strictEqual(wat.test_call_LoadImageA(0, missingGa, 0, 0, 0, 0x10) >>> 0, 0);
  });

  console.log(`\n${passed} checks passed`);
})().catch(err => { console.error(err); process.exit(1); });
