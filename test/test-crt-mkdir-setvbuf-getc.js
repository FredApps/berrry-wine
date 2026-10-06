#!/usr/bin/env node

// msvcrt entry points Dark Reign's demo (DKReign.exe, MSVC 1997) imports
// before its main menu: _mkdir, setvbuf, getc/fgetc, __p___mb_cur_max and
// __p__pctype -- and _stat, which used to zero 64 bytes of a 36-byte struct
// and so overwrote the caller's saved EBP and return address. Each is cdecl and pops only its return address; each is
// checked against the VFS or the CRT state it describes rather than a
// constant.

'use strict';

const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

const STACK = 0x00300000;
const call = (name, params) => {
  const args = params.map(p => `(local.get $${p})`);
  while (args.length < 5) args.push('(i32.const 0)');
  return String.raw`
  (func (export "t_${name}") ${params.map(p => `(param $${p} i32)`).join(' ')} (result i32)
    (i32.store offset=16 (global.get $reg_base) (i32.const ${STACK}))
    (i32.store offset=0 (global.get $reg_base) (i32.const 0x7e7e7e7e))
    ${params.map((p, i) => `(call $gs32 (i32.const ${STACK + 4 + 4 * i}) (local.get $${p}))`).join('\n    ')}
    (call $handle_${name} ${args.join(' ')} (i32.const 0))
    (if (i32.ne (i32.load offset=16 (global.get $reg_base)) (i32.const ${STACK + 4}))
      (then (unreachable)))
    (i32.load offset=0 (global.get $reg_base)))`;
};

const extraWat = String.raw`
  (func (export "t_init")
    (global.set $image_base (i32.const 0))
    (global.set $thunk_guest_base (i32.sub (global.get $THUNK_BASE) (global.get $GUEST_BASE))))
  (func (export "t_errno") (result i32)
    (if (result i32) (global.get $msvcrt_errno_ptr)
      (then (call $gl32 (global.get $msvcrt_errno_ptr)))
      (else (i32.const -1))))
  (func (export "t_set_acp") (param $cp i32) (global.set $ansi_code_page (local.get $cp)))
  ${call('_mkdir', ['path'])}
  ${call('fopen', ['path', 'mode'])}
  ${call('fclose', ['f'])}
  ${call('setvbuf', ['f', 'buf', 'mode', 'size'])}
  ${call('getc', ['f'])}
  ${call('fgetc', ['f'])}
  ${call('feof', ['f'])}
  ${call('__p___mb_cur_max', [])}
  ${call('__p__pctype', [])}
  ${call('_pctype', [])}
  ${call('_stat', ['path', 'buf'])}
  ${call('_makepath', ['path', 'drive', 'dir', 'fname', 'ext'])}
`;

(async () => {
  const harness = await bootRenderHarness({ extraWat, fonts: 'none' });
  const e = harness.exports;
  const vfs = harness.hostCtx.vfs;
  e.t_init();
  const ascii = (p, s) => [...s, '\0'].forEach((c, i) => e.guest_write8(p + i, c.charCodeAt(0)));
  const u32 = p => e.guest_read32(p) >>> 0;
  const u16 = p => e.guest_read16 ? e.guest_read16(p) & 0xffff : (u32(p) & 0xffff);
  const PATH = 0x1000, MODE = 0x1100, BUF = 0x2000;

  // --- _mkdir: creates, then EEXIST. (This VFS creates missing parents, as
  // its CreateDirectoryA does, so the ENOENT arm is not reachable here.)
  ascii(PATH, 'c:\\reign');
  assert.strictEqual(e.t__mkdir(PATH), 0, '_mkdir creates a new directory');
  assert(vfs.dirs.has('c:\\reign'), 'the directory exists in the VFS');
  assert.strictEqual(e.t__mkdir(PATH), -1, 'a second _mkdir fails');
  assert.strictEqual(e.t_errno(), 17, 'errno = EEXIST');

  // --- getc/fgetc over a real VFS file.
  const host = vfs.createFile('c:\\reign\\tactics.cfg', 0xc0000000, 2);
  vfs.writeFile(host, Uint8Array.from([0x41, 0xff, 0x0a]), 3);
  vfs.closeHandle ? vfs.closeHandle(host) : harness.host.fs_close_handle(host);
  ascii(PATH, 'c:\\reign\\tactics.cfg');
  ascii(MODE, 'rb');
  const f = e.t_fopen(PATH, MODE) >>> 0;
  assert.notStrictEqual(f, 0);
  assert.strictEqual(e.t_getc(f), 0x41, 'getc returns the first byte');
  assert.strictEqual(e.t_fgetc(f), 0xff, 'fgetc returns 0xff as an unsigned char, not EOF');
  assert.strictEqual(e.t_getc(f), 0x0a);
  assert.strictEqual(e.t_feof(f), 0, 'EOF not yet seen');
  assert.strictEqual(e.t_getc(f), -1, 'getc at end of file is EOF');
  assert.notStrictEqual(e.t_feof(f), 0, 'and latches _IOEOF');
  assert.strictEqual(e.t_getc(0x5555), -1, 'getc on a stream this CRT never opened is EOF');

  // --- setvbuf validates like msvcrt and keeps the stream unbuffered.
  const before = [0, 4, 8, 0x0c, 0x18].map(o => u32(f + o));
  assert.strictEqual(e.t_setvbuf(f, BUF, 0, 4096), 0, '_IOFBF with a sane size is accepted');
  assert.strictEqual(e.t_setvbuf(f, 0, 0x40, 512), 0, '_IOLBF without a buffer is accepted');
  assert.strictEqual(e.t_setvbuf(f, 0, 4, 0), 0, '_IONBF ignores size');
  assert.strictEqual(e.t_setvbuf(f, BUF, 0, 1), -1, 'a buffered size below 2 is refused');
  assert.strictEqual(e.t_setvbuf(f, BUF, 0, 0x80000000), -1, 'a size past INT_MAX is refused');
  assert.strictEqual(e.t_setvbuf(f, BUF, 2, 64), -1, 'an unknown mode is refused');
  assert.strictEqual(e.t_setvbuf(0x5555, BUF, 0, 64), -1, 'an unknown stream is refused');
  assert.deepStrictEqual([0, 4, 8, 0x0c, 0x18].map(o => u32(f + o)), before,
    'the FILE keeps its unbuffered layout; the caller buffer is not retained');
  assert.strictEqual(e.t_fclose(f), 0);

  // --- __p___mb_cur_max points at the value __mb_cur_max reports.
  e.t_set_acp(1252);
  const mb = e.t___p___mb_cur_max() >>> 0;
  assert.notStrictEqual(mb, 0);
  assert.strictEqual(u32(mb), 1, 'a single-byte code page: MB_CUR_MAX 1');
  e.t_set_acp(932);
  assert.strictEqual(e.t___p___mb_cur_max() >>> 0, mb, 'the variable has one address');
  assert.strictEqual(u32(mb), 2, 'a DBCS code page: MB_CUR_MAX 2');
  e.t_set_acp(1252);

  // --- __p__pctype: a pointer to a pointer one entry past the EOF slot.
  const table = e.t__pctype() >>> 0;
  const pp = e.t___p__pctype() >>> 0;
  assert.notStrictEqual(pp, 0);
  const pctype = u32(pp);
  assert.strictEqual(pctype, table + 2, '_pctype points at table[1], so _pctype[-1] is EOF');
  assert.strictEqual(u16(pctype - 2), 0, '_pctype[-1] (EOF) has no class');
  assert.notStrictEqual(u16(pctype + 2 * 0x41) & 0x101, 0, "_pctype['A'] is _UPPER|_ALPHA");
  assert.notStrictEqual(u16(pctype + 2 * 0x37) & 0x4, 0, "_pctype['7'] is _DIGIT");
  assert.notStrictEqual(u16(pctype + 2 * 0x20) & 0x8, 0, "_pctype[' '] is _SPACE");
  assert.strictEqual(e.t___p__pctype() >>> 0, pp, 'one variable');

  // --- _stat writes exactly msvcrt's 36-byte struct _stat, nothing past it.
  const STAT = 0x4000;
  const fillSentinel = () => { for (let i = 0; i < 64; i++) e.guest_write8(STAT + i, 0xaa); };
  const sentinelIntact = () => { for (let i = 36; i < 64; i++) if (e.guest_read8(STAT + i) !== 0xaa) return false; return true; };
  fillSentinel();
  ascii(PATH, 'c:\\reign\\tactics.cfg');
  assert.strictEqual(e.t__stat(PATH, STAT), 0, '_stat of an existing file');
  assert(sentinelIntact(), 'bytes 36..63 after the struct are untouched (the caller frame)');
  assert.strictEqual(u16(STAT + 6), 0x81b6, 'st_mode: _S_IFREG | 0666');
  assert.strictEqual(u16(STAT + 8), 1, 'st_nlink 1');
  assert.strictEqual(u32(STAT + 20), 3, 'st_size');
  assert.strictEqual(u32(STAT), 2, 'st_dev: drive C: is 2');
  assert.strictEqual(u32(STAT + 16), 2, 'st_rdev matches st_dev');
  fillSentinel();
  ascii(PATH, 'c:\\reign');
  assert.strictEqual(e.t__stat(PATH, STAT), 0, '_stat of a directory');
  assert(sentinelIntact(), 'a directory stat stays inside the struct too');
  assert.strictEqual(u16(STAT + 6) & 0xf000, 0x4000, 'st_mode: _S_IFDIR');
  fillSentinel();
  ascii(PATH, 'c:\\reign\\missing.cfg');
  assert.strictEqual(e.t__stat(PATH, STAT), -1, 'a missing path fails');
  for (let i = 0; i < 64; i++) assert.strictEqual(e.guest_read8(STAT + i), 0xaa, 'and writes nothing');

  // --- _makepath composes as msvcrt does.
  const OUT = 0x5000, DRV = 0x5200, DIR = 0x5300, FN = 0x5400, EXT = 0x5500;
  const cstr = p => { let r = ''; for (let c; (c = e.guest_read8(p)); p++) r += String.fromCharCode(c); return r; };
  const make = (drive, dir, fname, ext) => {
    for (const [p, v] of [[DRV, drive], [DIR, dir], [FN, fname], [EXT, ext]]) if (v !== null) ascii(p, v);
    e.guest_write32(OUT, 0x7e7e7e7e);
    e.t__makepath(OUT, drive === null ? 0 : DRV, dir === null ? 0 : DIR,
      fname === null ? 0 : FN, ext === null ? 0 : EXT);
    return cstr(OUT);
  };
  assert.strictEqual(make('c', '\\dark\\local', 'gamemsgs', 'txt'), 'c:\\dark\\local\\gamemsgs.txt',
    'separators added after dir and before ext');
  assert.strictEqual(make('c:', 'dark\\', 'a', '.cfg'), 'c:dark\\a.cfg', 'only the drive letter is used; existing separators kept');
  assert.strictEqual(make(null, 'x/', 'b', null), 'x/b', 'a trailing / counts as a separator; NULL parts are skipped');
  assert.strictEqual(make('', '', 'name', ''), 'name', 'empty parts are skipped');

  console.log('PASS _makepath, _stat writes 36 bytes, _mkdir errno, getc/fgetc, setvbuf validation, __p___mb_cur_max, __p__pctype');
})().catch(error => { console.error(error); process.exitCode = 1; });
