// The display-fullscreen claim is PROCESS state, not instance state.
//
// ChangeDisplaySettings runs wherever the guest's main thread runs, and in the
// browser's Worker backend (and under `run.js --threads`) that is not the
// instance lib/renderer.js holds. A mutable WASM global belongs to exactly one
// instance and is propagated to a worker only at spawn, so the guest set the
// flag in the worker's instance while `_displayFullscreen(win)` read the main
// thread's — which is why SimGolf asked for 800x600, was told yes, and still
// rendered in the corner of the Win98 desktop in threads mode.
//
// This test is the shape of that bug: two instances over ONE shared memory,
// the mode applied on the first, the answer read from the second. It fails on
// the per-instance-global design and passes only while the flag lives in
// $DX_PROCESS_STATE.
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

// Drives the real ChangeDisplaySettings core rather than the accessors, so the
// test cannot pass by exercising a setter nothing calls. DEVMODE offsets:
// dmFields 40, dmPelsWidth 108, dmPelsHeight 112; 0x00180000 is
// DM_PELSWIDTH|DM_PELSHEIGHT, and dwFlags 0 is what SimGolf passes.
const EXTRA_WAT = `
  (func (export "test_change_display_settings")
        (param $w i32) (param $h i32) (result i32)
    (local $dm i32)
    (local.set $dm (call $heap_alloc (i32.const 156)))
    (call $gs32 (i32.add (local.get $dm) (i32.const 40)) (i32.const 0x00180000))
    (call $gs32 (i32.add (local.get $dm) (i32.const 108)) (local.get $w))
    (call $gs32 (i32.add (local.get $dm) (i32.const 112)) (local.get $h))
    (call $change_display_settings_core (local.get $dm) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
  (func (export "test_change_display_settings_null") (result i32)
    (call $change_display_settings_core (i32.const 0) (i32.const 0))
    (i32.load offset=0 (global.get $reg_base)))
`;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

async function main() {
  const memory = new WebAssembly.Memory({
    initial: 8192, maximum: 8192, shared: true,
  });
  // Both instances exist before either writes, so a later instantiation
  // cannot be what clears the flag.
  const a = await bootRenderHarness({ extraWat: EXTRA_WAT, memory });
  const b = await bootRenderHarness({ extraWat: EXTRA_WAT, memory });

  check('neither instance claims the display before a mode is applied', () => {
    assert.strictEqual(a.exports.get_display_fullscreen(), 0);
    assert.strictEqual(b.exports.get_display_fullscreen(), 0);
  });

  check('a mode applied on one instance is visible from the other', () => {
    const rc = a.exports.test_change_display_settings(800, 600);
    assert.strictEqual(rc, 0, `DISP_CHANGE_SUCCESSFUL expected, got ${rc}`);
    assert.strictEqual(a.exports.get_display_fullscreen(), 1,
      'the instance that applied the mode does not claim the display');
    assert.strictEqual(b.exports.get_display_fullscreen(), 1,
      'the renderer-side instance cannot see the claim (per-instance global?)');
  });

  check('the mode itself is shared too, and reports what was asked for', () => {
    assert.strictEqual(b.exports.get_display_mode_active(), 1);
    assert.strictEqual(b.exports.get_display_mode_w(), 800);
    assert.strictEqual(b.exports.get_display_mode_h(), 600);
  });

  check('a mode no display has is refused and leaves the claim alone', () => {
    const rc = b.exports.test_change_display_settings(4, 4);
    assert.strictEqual(rc, -2, `DISP_CHANGE_BADMODE expected, got ${rc}`);
    assert.strictEqual(a.exports.get_display_fullscreen(), 1);
  });

  check('NULL lpDevMode releases the claim, on both instances at once', () => {
    b.exports.test_change_display_settings_null();
    assert.strictEqual(b.exports.get_display_fullscreen(), 0);
    assert.strictEqual(a.exports.get_display_fullscreen(), 0,
      'the claim was released in one instance only');
  });

  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
