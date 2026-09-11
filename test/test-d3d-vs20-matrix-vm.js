'use strict';
const assert = require('assert');
const { bootRenderHarness } = require('./render-helper');

(async () => {
  const { exports: e, memory } = await bootRenderHarness({ fonts: 'none', extraWat: `
    (export "matrix20_decode" (func $d3d_shader_ir_compile20))
    (func (export "matrix20_alloc") (param i32) (result i32) (call $g2w (call $heap_alloc (local.get 0))))
  ` });
  const u = new Uint32Array(memory.buffer), f = new Float32Array(memory.buffer), bytes = new Uint8Array(memory.buffer);
  const shapes = [[20,4,4], [21,4,3], [22,3,4], [23,3,3], [24,3,2]];
  const arg = (bank, index, selector = 228, modifier = 0) => [bank,index,selector,modifier];
  const instruction = (op, ...operands) => ({op, operands});
  const free = (...pointers) => pointers.forEach(p => e.d3d_shader_vm_free(p));
  const register = (ctx, bank, index) => (ctx + (bank === 2 && index >= 128 ?
    65568 + (index - 128) * 64 : 32 + (bank * 128 + index) * 64)) / 4;
  function ir(instructions) {
    const n = 32 + instructions.length * 128, p = e.matrix20_alloc(n); assert(p);
    u.fill(0,p/4,(p+n)/4); u.set([0x44534952,1,0,0xfffe0200,instructions.length,1,n,1],p/4);
    instructions.forEach((ins,i) => {
      const at = (p+32+i*128)/4; u.set([ins.op,i+1,ins.operands.length,0],at);
      ins.operands.forEach((operand,j) => u.set(operand,at+4+j*4));
    });
    return p;
  }
  let cases = 0;
  const vector = [[1,2,3,4], [2,3,4,5], [3,4,5,6], [4,5,6,7]];
  const value = (c, component, lane) => c * 4 + component + lane;
  for (const [op, columns, rows] of shapes) for (const mode of ['direct', 'relative127', 'relative252', 'swizzleNegate']) {
    const relative = mode.startsWith('relative'), base = mode === 'relative252' ? 252 : 127;
    const addresses = base === 252 ? [0,1,3,-253] : [0,1,-1,128];
    const swizzle = mode === 'swizzleNegate' ? 27 : 228, negate = mode === 'swizzleNegate';
    const instructions = [];
    if (relative) instructions.push(instruction(46,arg(3,0,1),arg(1,1,0)));
    instructions.push(instruction(op,arg(0,0,(1<<rows)-1),arg(1,0,swizzle,negate?1:0),arg(2,base,228,relative?256:0)));
    const inputIR = ir(instructions);
    assert.strictEqual(e.d3d_shader_vm_compile(inputIR),0,'public VS2 remains rejected');
    const program = e.d3d_shader_vm_compile_vs20(inputIR); assert(program); free(inputIR);
    const laneMask=mode==='relative252'?15:5;
    const ctx = e.d3d_shader_vm_context(program,laneMask); assert(ctx);
    for(let c=0;c<256;c++) for(let component=0;component<4;component++) for(let lane=0;lane<4;lane++)
      f[register(ctx,2,c)+component*4+lane]=value(c,component,lane);
    vector.forEach((v,component)=>f.set(v,register(ctx,1,0)+component*4));
    f.set(addresses,register(ctx,1,1));
    f.fill(999,register(ctx,0,0),register(ctx,0,0)+16);
    bytes.fill(0x65,ctx+62848,ctx+65568);
    if(relative) assert.strictEqual(e.d3d_shader_vm_run(ctx,1),1,'MOVA budget boundary');
    assert.strictEqual(e.d3d_shader_vm_run(ctx,1),0,'matrix retires as one packet');
    for(let component=0;component<4;component++) for(let lane=0;lane<4;lane++) {
      let expected=999;
      if(component<rows && (laneMask&(1<<lane))) {
        const c=base+component+(relative?addresses[lane]:0);
        expected=0;
        if(c>=0&&c<256) for(let j=0;j<columns;j++) {
          const v=vector[(swizzle>>>(j*2))&3][lane]*(negate?-1:1);
          expected=Math.fround(expected+Math.fround(v*value(c,j,lane)));
        }
      }
      assert.strictEqual(f[register(ctx,0,0)+component*4+lane],expected,`${op}/${mode} component${component} lane${lane}`);
    }
    assert(bytes.subarray(ctx+62848,ctx+65568).every(v=>v===0x65),'matrix reads do not alter sampler records');
    free(ctx,program); cases++;
  }
  for(const [op,,rows] of shapes) {
    const good=[arg(0,0,(1<<rows)-1),arg(1,0),arg(2,256-rows)];
    const p=ir([instruction(op,...good)]),program=e.d3d_shader_vm_compile_vs20(p);
    assert(program,'last statically valid direct matrix base accepted'); free(program,p); cases++;
    const bad=[
      [arg(0,0,1),good[1],good[2]],
      [good[0],good[1],arg(2,257-rows)],
      [good[0],good[1],arg(2,257-rows,228,256)],
      [good[0],good[1],arg(2,127,0)],
      [good[0],good[1],arg(2,127,228,1)],
      [good[0],arg(0,0),good[2]],
      [arg(0,3,(1<<rows)-1),good[1],arg(0,2)],
      [good[0],good[1],arg(0,13-rows)],
      [good[0],good[1],arg(1,17-rows)],
    ];
    for(const operands of bad){const q=ir([instruction(op,...operands)]);
      assert.strictEqual(e.d3d_shader_vm_compile_vs20(q),0,'malformed matrix normalized IR rejected'); free(q);cases++;}
  }
  for(const [op,columns,rows] of shapes)for(const matrixBank of[0,1]){
    const base=(matrixBank===0?12:16)-rows;
    const vectorBank=matrixBank===0?2:0,vectorIndex=matrixBank===0?255:0;
    const p=ir([instruction(op,arg(6,0,(1<<rows)-1),arg(vectorBank,vectorIndex),arg(matrixBank,base))]);
    const program=e.d3d_shader_vm_compile_vs20(p);assert(program);free(p);
    const ctx=e.d3d_shader_vm_context(program,15);
    for(let component=0;component<4;component++)f.fill(component+1,register(ctx,vectorBank,vectorIndex)+component*4,register(ctx,vectorBank,vectorIndex)+component*4+4);
    for(let row=0;row<rows;row++)f.fill(row+1,register(ctx,matrixBank,base+row),register(ctx,matrixBank,base+row)+16);
    assert.strictEqual(e.d3d_shader_vm_run(ctx,1),0);
    for(let row=0;row<rows;row++)assert.strictEqual(f[register(ctx,6,0)+row*4],columns*(columns+1)/2*(row+1));
    free(ctx,program);cases++;
  }
  // Decoder integration uses full oPos from v0 plus matrix output in oT0 so
  // smaller shapes need not initialize components outside their exact mask.
  for(const [op,columns,rows] of shapes) {
    const tokens=[0xfffe0200,0x0200001f,0x80000000,0x900f0000,
      0x03000000|op,0xe0000000|(((1<<rows)-1)<<16),0x90e40000,0xa0e4007f,
      0x02000001,0xc00f0000,0x90e40000,0xffff];
    const p=e.matrix20_alloc(tokens.length*4);u.set(tokens,p/4);
    const native=e.matrix20_decode(p,tokens.length);assert(native,'private decoder matrix accepted');
    const program=e.d3d_shader_vm_compile_vs20(native);assert(program);
    const ctx=e.d3d_shader_vm_context(program,15);
    for(let component=0;component<4;component++)f.fill(component+1,register(ctx,1,0)+component*4,register(ctx,1,0)+component*4+4);
    for(let row=0;row<rows;row++)f.fill(row+1,register(ctx,2,127+row),register(ctx,2,127+row)+16);
    assert.strictEqual(e.d3d_shader_vm_run(ctx,10),0);
    for(let row=0;row<rows;row++)assert.strictEqual(f[register(ctx,6,0)+row*4],columns*(columns+1)/2*(row+1));
    free(ctx,program,p);e.d3d_shader_ir_free(native);cases++;
  }
  console.log(`Private VS2 matrix VM PASS ${cases} cases`);
})().catch(error=>{console.error(error);process.exitCode=1;});
