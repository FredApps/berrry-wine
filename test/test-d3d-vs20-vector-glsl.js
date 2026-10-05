'use strict';
// Pure lowering checks; actual GPU/native parity is exercised separately.
const assert=require('assert'),Shader=require('../lib/d3d9-shader');
const I=(opcode,...args)=>({opcode,args}),opts={experimentalVS20:true};
const mova=mask=>I(46,(0xb0000000|mask<<16)>>>0,0x90e40001);
const read=component=>({...I(1,0xd00f0000,0xa0e42000),
 relativeAddressBanks:[null,'a0'],relativeAddressComponents:[null,component]});
const shader=body=>({stage:'vertex',version:0xfffe0200,
 instructions:[I(1,0xc00f0000,0x90e40000),...body].map((ins,i)=>({...ins,offset:i+1}))});
for(let component=0;component<4;component++){
 for(let mask=1;mask<16;mask++){
  const input=shader([mova(mask),read(component)]);
  if(mask&(1<<component)){
   const source=Shader.compileIR(input,opts).source;
   assert(source.includes(`a0.${'xyzw'[component]} + 0.0`));
   assert(source.includes(`a0.${'xyzw'.split('').filter((_,i)=>mask&(1<<i)).join('')} =`));
  }else assert.throws(()=>Shader.compileIR(input,opts),/a0 initialization/);
 }
 // Unconditional callee writes propagate only their selected components.
 const label=0xa0e41000;
 const good=shader([I(25,label),read(component),I(28),I(30,label),mova(1<<component),I(28)]);
 assert(Shader.compileIR(good,opts));
 const bad=shader([I(26,label,0xe0e40800),read(component),I(28),I(30,label),mova(1<<component),I(28)]);
 assert.throws(()=>Shader.compileIR(bad,opts),/a0 initialization/);
 const inherited=shader([mova(1<<component),I(25,label),I(28),I(30,label),read(component),I(28)]);
 assert(Shader.compileIR(inherited,opts));
 // Both IF arms must define the requested address component.
 assert(Shader.compileIR(shader([I(40,0xe0e40800),mova(1<<component),I(42),mova(1<<component),I(43),read(component)]),opts));
 assert.throws(()=>Shader.compileIR(shader([I(40,0xe0e40800),mova(1<<component),I(43),read(component)]),opts),/a0 initialization/);
 assert.throws(()=>Shader.compileIR(shader([I(38,0xf0e40000),mova(1<<component),I(39),read(component)]),opts),/a0 initialization/);
}
// Equal projected tokens may select different address components: metadata
// is indexed by operand, never looked up by token identity.
const mixed={...I(2,0xd00f0000,0xa0e42000,0xa0e42000),
 relativeAddressBanks:[null,'a0','a0'],relativeAddressComponents:[null,1,3]};
const text=Shader.compileIR(shader([mova(10),mixed]),opts).source;
assert(text.includes('a0.y + 0.0'));assert(text.includes('a0.w + 0.0'));
for(const component of [-1,4,1.5])assert.throws(()=>Shader.compileIR(shader([mova(15),read(component)]),opts),/component metadata/);
const badAL={...read(1),relativeAddressBanks:[null,'aL']};
assert.throws(()=>Shader.compileIR(shader([I(27,0xf0e40800,0xf0e40000),badAL,I(29)]),opts),/component metadata/);
assert.throws(()=>Shader.compileIR(shader([mova(15),read(0)])),/invalid D3D shader IR/);
console.log('PASS vector a0 GLSL components, 15 masks, joins, call effects and malformed metadata');
