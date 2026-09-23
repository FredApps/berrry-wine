'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');
const apis = require('../src/api_table.json');
const extraWat = String.raw`
 (func (export "device") (result i32)
   (local $p i32) (local $s i32)
   (local.set $p (call $dx_create_com_obj (i32.const 20) (global.get $DX_VTBL_D3DDEV1)))
   (local.set $s (call $heap_alloc (i32.const 4096)))
   (call $d3ddev_init_state (local.get $s))
   (i32.store offset=16 (call $dx_from_this (local.get $p)) (local.get $s))
   (local.get $p))
 (func (export "state") (param $p i32) (result i32) (call $d3ddev_state (local.get $p)))
 (func (export "buffer") (param $p i32) (param $buf i32)
   (store.field DxObject misc0 (call $dx_from_this (local.get $p)) (local.get $buf)))
 (func (export "matrix") (param $n i32) (result i32)
   (i32.add (global.get $D3DIM_MATRICES) (i32.mul (local.get $n) (i32.const 64))))
 (func (export "ddraw") (result i32)
   (call $dx_create_com_obj (i32.const 1) (global.get $DX_VTBL_DDRAW)))
 (func (export "target") (param $dev i32) (param $surf i32) (result i32)
   (call $d3dim_set_render_target (local.get $dev) (local.get $surf))
   (i32.load offset=20 (call $dx_from_this (local.get $surf))))
 (func (export "invoke") (param $id i32) (param $sp i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
   (i32.store offset=16 (global.get $reg_base) (local.get $sp))
   (call $dispatch_api_table (local.get $id) (local.get $a) (local.get $b) (local.get $c)
     (i32.const 0) (i32.const 0) (i32.const 0))
   (i32.load (global.get $reg_base)))
`;
(async () => {
  const trace = [];
  const { exports: e, memory } = await bootRenderHarness({ extraWat, fonts: 'none',
    extraHostOverrides: { dx_trace: (...args) => { if (args[0] === 7) trace.push(args.slice(1)); } } });
  e.init_dx_com_thunks();
  const dev = e.device(), state = e.state(dev), sp = e.guest_alloc(128);
  const desc = e.guest_alloc(20), out = e.guest_alloc(48), data = e.guest_alloc(48);
  const size = 24576, regular = e.guest_alloc(size), base = 0x40000000;
  for (let page = 0; page < 7; page++) {
    e.test_virtual_map_commit(base + page * 4096, 4096);
    e.test_virtual_map_commit(base + 0x10000 + page * 4096, 4096);
    for (let i = 0; i < 4096; i++) e.guest_write8(base + 0x10000 + page * 4096 + i, 0xa7);
  }
  assert.notStrictEqual(e.guest_to_wasm(base + 4096), e.guest_to_wasm(base) + 4096);
  const call = (name, pop, a, b = 0, c = 0) => {
    e.guest_write32(sp + pop, 0xdeadbeef);
    assert.strictEqual(e.invoke(apis.find(api => api.name === name).id, sp, a, b, c) >>> 0, 0, name);
    assert.strictEqual(e.get_esp(), sp + pop);
    assert.strictEqual(e.guest_read32(sp + pop) >>> 0, 0xdeadbeef);
  };
  [20, 1, 0, size, 0].forEach((v, i) => e.guest_write32(desc + i * 4, v));
  call('IDirect3DDevice_CreateExecuteBuffer', 20, dev, desc, out);
  const eb = e.guest_read32(out);
  call('IDirect3DExecuteBuffer_Lock', 12, eb, desc);
  const ownedBuffer = e.guest_read32(desc + 16);
  const words = [], expectedTrace = [];
  function op(code, stride, records) {
    expectedTrace.push([code, stride, records.length, words.length * 4]);
    words.push(code | (stride << 8) | (records.length << 16), ...records.flat());
  }
  op(4, 8, [[2, 1], [3, 2]]);
  op(5, 12, [[4, 2, 3]]);
  op(6, 8, [[1, 4]]);
  op(7, 8, [[2, 0x11223344], [3, 0x55667788]]);
  op(8, 8, [[8, 1], [9, 2]]);
  op(9, 16, [[2, 2 << 16, 1, 0]]); // COPY vertex 0 to vertex 2.
  op(12, 16, [[0, 0, 0, 32]]); // Skip the following render-state instruction.
  words.push(8 | (8 << 8) | (1 << 16), 8, 99);
  op(14, 24, [[1, 0xabcdef01, 11, 22, 33, 44]]);
  op(12, 16, [[0, 1, 0, 0]]); // Untaken branch.
  op(11, 0, []);
  words.push(0); // Padding keeps the pre-existing end-of-range policy out of this test.
  const stream = Buffer.alloc(words.length * 4);
  words.forEach((v, i) => stream.writeUInt32LE(v >>> 0, i * 4));
  function run(buf, offset, bytes = stream, large = false) {
    e.buffer(eb, buf);
    for (let i = 0; i < 96; i++) e.guest_write8(buf + i, i < 32 ? i + 1 : 0xcc);
    for (let i = -4; i < bytes.length + 4; i++) e.guest_write8(buf + offset + i, 0xcc);
    for (let i = 0; i < bytes.length; i++) e.guest_write8(buf + offset + i, bytes[i]);
    const matrices = new Float32Array(memory.buffer, e.matrix(0), 64);
    matrices.fill(0);
    for (let i = 0; i < 4; i++) matrices[i * 5] = 2;
    [48, 0, 3, offset, bytes.length, 0, 0, 0, 0, 0, 0, 0].forEach((v, i) => e.guest_write32(data + i * 4, v));
    call('IDirect3DExecuteBuffer_SetExecuteData', 12, eb, data);
    call('IDirect3DExecuteBuffer_Unlock', 8, eb);
    e.guest_write32(state + 288, 0);
    trace.length = 0;
    const cursor = e.guest_span_cursor_bytes(), overflow = e.guest_span_overflow_count();
    call('IDirect3DDevice_Execute', 20, dev, eb);
    assert.strictEqual(e.guest_read32(state + 288), large ? 2199 : 1, `render state at offset=${offset}`);
    if (!large) {
      assert.strictEqual(e.guest_read32(state + 292), 2);
      assert.strictEqual(e.guest_read32(state + 2312) >>> 0, 0x11223344);
      assert.strictEqual(e.guest_read32(state + 2316) >>> 0, 0x55667788);
      for (let i = 0; i < 16; i++) {
        assert.strictEqual(matrices[48 + i], i % 5 === 0 ? 4 : 0);
        assert.strictEqual(new Float32Array(memory.buffer, e.guest_to_wasm(state), 16)[i], matrices[48 + i]);
      }
      for (let i = 0; i < 32; i++) assert.strictEqual(e.guest_read8(buf + 64 + i), i + 1, 'COPY record');
      call('IDirect3DExecuteBuffer_GetExecuteData', 12, eb, out);
      [1, 0xabcdef01, 11, 22, 33, 44].forEach((v, i) => assert.strictEqual(e.guest_read32(out + 24 + i * 4) >>> 0, v));
      assert.deepStrictEqual(trace, expectedTrace.map(([code, stride, n, rel]) => [code, stride, n, offset + rel]));
    }
    for (let i = 0; i < bytes.length; i++) assert.strictEqual(e.guest_read8(buf + offset + i), bytes[i], 'instructions unchanged');
    for (let i = 1; i <= 4; i++) assert.strictEqual(e.guest_read8(buf + offset - i), 0xcc);
    for (let i = 0; i < 4; i++) assert.strictEqual(e.guest_read8(buf + offset + bytes.length + i), 0xcc);
    assert.strictEqual(e.guest_span_cursor_bytes(), cursor);
    assert.strictEqual(e.guest_span_overflow_count(), overflow);
  }
  run(regular, 256);
  // Move the page boundary across every instruction header and record byte.
  for (let split = 1; split < stream.length; split++) run(base + 64, 4096 - 64 - split);
  const large = Buffer.alloc(4 + 2200 * 8 + 4);
  large.writeUInt32LE(8 | (8 << 8) | (2200 << 16));
  for (let i = 0; i < 2200; i++) { large.writeUInt32LE(8, 4 + i * 8); large.writeUInt32LE(i, 8 + i * 8); }
  large.writeUInt32LE(11, large.length - 4);
  run(base + 64, 256, large, true); // No whole-group 16KiB scratch limit.
  let branchCases = 0;
  // Status comes either from SetExecuteData or an executed SETSTATUS record.
  // Use a high bit and noncanonical TRUE to catch signed/boolean shortcuts.
  for (const status of [0, 0x80000000, 0xa5a55a5a, 0xffffffff])
    for (const mask of [0, 0x80000000, 0xff, 0xffffffff])
      for (const value of [0, 0x80000000, 0x5a, 0xffffffff])
        for (const negate of [0, 1, 2]) for (const seedOpcode of [false, true])
          for (const split of [0, 7, 17]) {
            const buf = split ? base + 64 : regular;
            const offset = split ? 4096 - 64 - split : 256;
            e.buffer(eb, buf);
            const branchWords = seedOpcode ? [14 | (24 << 8) | (1 << 16), 1, status, 0, 0, 0, 0] : [];
            branchWords.push(12 | (16 << 8) | (1 << 16), mask, value, negate, 32,
              8 | (8 << 8) | (1 << 16), 8, 7, 11, 0);
            branchWords.forEach((v, i) => e.guest_write32(buf + offset + i * 4, v));
            // Unlock ensures the existing per-buffer status owner before seeding.
            call('IDirect3DExecuteBuffer_Unlock', 8, eb);
            [48, 0, 0, offset, branchWords.length * 4, 0, 1, seedOpcode ? 0 : status, 0, 0, 0, 0]
              .forEach((v, i) => e.guest_write32(data + i * 4, v));
            call('IDirect3DExecuteBuffer_SetExecuteData', 12, eb, data);
            e.guest_write32(state + 288, 0);
            call('IDirect3DDevice_Execute', 20, dev, eb);
            const equal = ((status & mask) >>> 0) === value;
            const taken = negate ? !equal : equal;
            assert.strictEqual(e.guest_read32(state + 288), taken ? 0 : 7,
              `branch status=${status} mask=${mask} value=${value} negate=${negate} opcode=${seedOpcode} split=${split}`);
            call('IDirect3DExecuteBuffer_GetExecuteData', 12, eb, out);
            assert.strictEqual(e.guest_read32(out + 28) >>> 0, status, 'branch preserves status');
            branchCases++;
          }
  let multiCases = 0;
  // First, middle, last and no matching branch; distinct destinations make
  // first-match ordering observable. Also cover taken zero-offset termination.
  for (const count of [0, 1, 3]) for (const match of [-1, 0, 1, 2])
    for (const terminate of [false, true]) for (const split of [0, 7, 23, 39]) {
      if (match >= count) continue;
      const buf = split ? base + 64 : regular;
      const offset = split ? 4096 - 64 - split : 256;
      const program = [12 | (16 << 8) | (count << 16)];
      const destinations = 4 + count * 16;
      for (let i = 0; i < count; i++) program.push(0xffffffff, i >= match && match >= 0 ? 5 : 6, 0,
        terminate ? 0 : destinations + (i + 1) * 16);
      // Four independently observable write-and-exit destinations.
      for (let i = 0; i < 4; i++) program.push(8 | (8 << 8) | (1 << 16), 8, i + 1, 11);
      program.push(0);
      e.buffer(eb, buf);
      program.forEach((v, i) => e.guest_write32(buf + offset + i * 4, v));
      call('IDirect3DExecuteBuffer_Unlock', 8, eb);
      [48, 0, 0, offset, program.length * 4, 0, 1, 5, 0, 0, 0, 0]
        .forEach((v, i) => e.guest_write32(data + i * 4, v));
      call('IDirect3DExecuteBuffer_SetExecuteData', 12, eb, data);
      e.guest_write32(state + 288, 0);
      call('IDirect3DDevice_Execute', 20, dev, eb);
      assert.strictEqual(e.guest_read32(state + 288), match < 0 ? 1 : terminate ? 0 : match + 2,
        `multi branch count=${count} match=${match} terminate=${terminate} split=${split}`);
      multiCases++;
    }
  for (const count of [0, 1, 3]) for (const split of [0, 7, 29, 53]) {
    const buf = split ? base + 64 : regular;
    const offset = split ? 4096 - 64 - split : 256;
    const program = [14 | (24 << 8) | (count << 16)];
    for (let i = 0; i < count; i++) program.push(1, 0x100 + i, 0, 0, 0, 0);
    program.push(11, 0);
    e.buffer(eb, buf);
    program.forEach((v, i) => e.guest_write32(buf + offset + i * 4, v));
    call('IDirect3DExecuteBuffer_Unlock', 8, eb);
    [48, 0, 0, offset, program.length * 4, 0, 1, 5, 0, 0, 0, 0]
      .forEach((v, i) => e.guest_write32(data + i * 4, v));
    call('IDirect3DExecuteBuffer_SetExecuteData', 12, eb, data);
    call('IDirect3DDevice_Execute', 20, dev, eb);
    call('IDirect3DExecuteBuffer_GetExecuteData', 12, eb, out);
    assert.strictEqual(e.guest_read32(out + 28), count ? 0x100 + count - 1 : 5, `status count=${count} split=${split}`);
    multiCases++;
  }
  // Real render target: vary instruction and vertex crossings independently.
  const surfaceDesc = e.guest_alloc(128);
  for (let i = 0; i < 128; i++) e.guest_write8(surfaceDesc + i, 0);
  for (const [off, value] of [[0, 108], [4, 0x1007], [8, 32], [12, 32],
    [72, 32], [76, 0x40], [84, 16], [88, 0xf800], [92, 0x7e0], [96, 0x1f], [104, 0x40]])
    e.guest_write32(surfaceDesc + off, value);
  call('IDirectDraw_CreateSurface', 20, e.ddraw(), surfaceDesc, out);
  const dib = e.target(dev, e.guest_read32(out));
  const pixels = new Uint8Array(memory.buffer, dib, 32 * 32 * 2);
  const bits = value => new Uint32Array(new Float32Array([value]).buffer)[0];
  let primitiveCases = 0;
  let vertexCases = 0;
  for (const [code, stride, records] of [[1, 4, [1, 0x00010001]],
    [2, 4, [0x00010000, 0x00020001]], [3, 8, [0, 0, 0x00010000, 2]]]) {
    const primitive = [code | (stride << 8) | (2 << 16), ...records, 11, 0];
    function draw(buf, offset, fill = 1, visible = 7) {
      e.buffer(eb, buf);
      [[2, 2], [20, 2], [2, 20]].forEach(([x, y], i) => {
        [bits(x), bits(y), bits(0.5), bits(visible & (1 << i) ? 1 : -1), 0xffff0000, 0, 0, 0]
          .forEach((v, j) => e.guest_write32(buf + i * 32 + j * 4, v));
      });
      primitive.forEach((v, i) => e.guest_write32(buf + offset + i * 4, v));
      [48, 0, 3, offset, primitive.length * 4, 0, 0, 0, 0, 0, 0, 0]
        .forEach((v, i) => e.guest_write32(data + i * 4, v));
      call('IDirect3DExecuteBuffer_SetExecuteData', 12, eb, data);
      e.guest_write32(state + 288, fill);
      const before = Array.from({ length: 96 }, (_, i) => e.guest_read8(buf + i));
      const cursor = e.guest_span_cursor_bytes(), overflow = e.guest_span_overflow_count();
      pixels.fill(0);
      call('IDirect3DDevice_Execute', 20, dev, eb);
      assert.deepStrictEqual(Array.from({ length: 96 }, (_, i) => e.guest_read8(buf + i)), before, 'vertices unchanged');
      assert.strictEqual(e.guest_span_cursor_bytes(), cursor, 'primitive spans released');
      assert.strictEqual(e.guest_span_overflow_count(), overflow);
      return Buffer.from(pixels);
    }
    const expected = draw(regular, 256);
    assert(expected.some(byte => byte !== 0), `opcode ${code} rendered`);
    for (let split = 1; split < primitive.length * 4; split++) {
      assert.deepStrictEqual(draw(base + 64, 4096 - 64 - split), expected, `opcode=${code} split=${split}`);
      primitiveCases++;
    }
    for (const fill of code === 3 ? [1, 2, 3] : [1]) {
      for (const visible of code === 3 ? [0, 1, 2, 3, 4, 5, 6, 7] : [7]) {
        const control = draw(regular, 256, fill, visible);
        if (visible === 7) assert(control.some(byte => byte !== 0), `opcode=${code} fill=${fill} rendered`);
        for (let split = 1; split < 96; split++) {
          assert.deepStrictEqual(draw(base + 4096 - split, 256, fill, visible), control,
            `vertex opcode=${code} fill=${fill} visible=${visible} split=${split}`);
          vertexCases++;
        }
      }
    }
  }
  // Globe seeds DEFAULT, transforms vertices, then exits if a common clip plane remains.
  // Exercise the public stream/status/branch contract, not only projected coordinates.
  let clipCases = 0;
  const inside = [0, 0, 0.5];
  const outside = [[-2, 0, 0.5], [2, 0, 0.5], [0, 2, 0.5], [0, -2, 0.5], [0, 0, -1], [0, 0, 2]];
  const clips = [{ vertices: [inside], union: 0, intersection: 0 },
    { vertices: [], union: 0, intersection: 63 }];
  outside.forEach((v, plane) => {
    clips.push({ vertices: [v, v], union: 1 << plane, intersection: 1 << plane });
    clips.push({ vertices: [v, inside], union: 1 << plane, intersection: 0 });
  });
  clips.push({ vertices: outside, union: 63, intersection: 0 });
  clips.push({ vertices: [[1.5, 0, 0.5]], w: 2, union: 0, intersection: 0 });
  clips.push({ vertices: [inside], w: -1, union: 47, intersection: 47 });
  clips.push({ vertices: [[0.0001, 0, 0.000005]], w: 0.00001, union: 2, intersection: 2 });
  for (const buf of [regular, base + 4090, base + 4030]) for (const mode of [0, 1, 2]) for (const grouped of [false, true]) {
    for (const { vertices, union, intersection, w = 1 } of clips) {
      e.buffer(eb, buf);
      const matrices = new Float32Array(memory.buffer, e.guest_to_wasm(state), 48);
      matrices.fill(0);
      for (let matrix = 0; matrix < 3; matrix++) for (let axis = 0; axis < 4; axis++)
        matrices[matrix * 16 + axis * 5] = 1;
      matrices[47] = w;
      vertices.forEach((v, i) => {
        const f = new Float32Array([...v, 0, 0, 1, 0, 0]);
        new Uint32Array(f.buffer).forEach((word, j) => e.guest_write32(buf + i * 32 + j * 4, word));
      });
      const instructions = [14 | (24 << 8) | (1 << 16), 1, 0x01fff000, 0, 0, 0, 0,
        9 | (16 << 8) | ((grouped ? 1 : vertices.length) << 16)];
      if (grouped) instructions.push(mode, 8 << 16, vertices.length, 0);
      else vertices.forEach((_, i) => instructions.push(mode, i | ((i + 8) << 16), 1, 0));
      instructions.push(12 | (16 << 8) | (1 << 16), 0x3f000, 0, 1, 0,
        8 | (8 << 8) | (1 << 16), 8, 123, 11, 0);
      instructions.forEach((v, i) => e.guest_write32(buf + 512 + i * 4, v));
      [48, 0, vertices.length, 512, instructions.length * 4, 0, 0, 0, 0, 0, 0, 0]
        .forEach((v, i) => e.guest_write32(data + i * 4, v));
      call('IDirect3DExecuteBuffer_SetExecuteData', 12, eb, data);
      call('IDirect3DExecuteBuffer_Unlock', 8, eb);
      e.guest_write32(state + 288, 0);
      const cursor = e.guest_span_cursor_bytes(), overflow = e.guest_span_overflow_count();
      call('IDirect3DDevice_Execute', 20, dev, eb);
      e.guest_write32(out, 48);
      call('IDirect3DExecuteBuffer_GetExecuteData', 12, eb, out);
      const expected = mode === 2 ? 0x01fff000 : 0x01fc0000 | union | (intersection << 12);
      assert.strictEqual(e.guest_read32(out + 28) >>> 0, expected >>> 0,
        `clip status mode=${mode} vertices=${JSON.stringify(vertices)} buf=${buf.toString(16)}`);
      assert.strictEqual(e.guest_read32(state + 288), (expected & 0x3f000) ? 0 : 123, 'clip branch');
      assert.strictEqual(e.guest_span_cursor_bytes(), cursor);
      assert.strictEqual(e.guest_span_overflow_count(), overflow);
      clipCases++;
    }
  }
  console.log(`PASS Execute clip status: ${clipCases} public stream/status/branch cases`);
  for (let page = 0; page < 7; page++) for (let i = 0; i < 4096; i++)
    assert.strictEqual(e.guest_read8(base + 0x10000 + page * 4096 + i), 0xa7, 'neighbor backing');
  e.buffer(eb, ownedBuffer); // Borrowed test mappings are not heap owners.
  call('IDirect3DExecuteBuffer_Release', 8, eb);
  console.log(`PASS Execute instruction walker: control + ${stream.length - 1} sparse splits + 2200-record group + ${primitiveCases} record / ${vertexCases} vertex pixel comparisons + ${branchCases} masked branches + ${multiCases} multi-record cases, trace/ABI/guards`);
})().catch(error => { console.error(error); process.exitCode = 1; });
