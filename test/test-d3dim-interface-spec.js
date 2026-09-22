'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {interfaces,vtableGlobals}=require('../tools/d3dim-methods');
const apis=require('../src/api_table.json');
const {WAT_FILES}=require('../lib/compile-wat');
const root=path.join(__dirname,'..');
const handlers=new Set();
for(const file of WAT_FILES){
  const source=fs.readFileSync(path.join(root,'src',file),'utf8').replace(/;;[^\n]*/g,'');
  for(const match of source.matchAll(/\(func\s+\$(handle_[^\s()]+)/g))handlers.add(match[1]);
}
function validate(ifaces,vtables,table,functions){
  const names=new Set();
  for(const iface of ifaces){
    const vt=vtables.find(v=>v.prefix===iface.prefix);
    assert(vt,`${iface.prefix}: missing vtable`);
    assert.deepStrictEqual(vt.methods,iface.methods.map(m=>m.name),'vtable order');
    for(const m of iface.methods){
      const name=iface.prefix+'_'+m.name;
      assert(!names.has(name),`duplicate ${name}`);names.add(name);
      for(const key of Object.keys(m))assert(['name','nargs','handler'].includes(key),`obsolete recipe ${key}`);
      assert(Number.isInteger(m.nargs)&&m.nargs>0,`${name}: invalid arity`);
      const api=table.find(a=>a.name===name);assert(api,`${name}: missing API`);
      assert.strictEqual(api.handler,m.handler,`${name}: alias mismatch`);
      assert(functions.has('handle_'+(m.handler||name)),`${name}: missing implementation`);
    }
  }
  return names.size;
}
const count=validate(interfaces,vtableGlobals,apis,handlers);
assert(!fs.existsSync(path.join(root,'tools/gen_d3dim_stubs.js')),'obsolete overwrite tool resurrected');
const clone=x=>JSON.parse(JSON.stringify(x));
const obsolete=clone(interfaces);obsolete[0].methods[0].body='OK';
assert.throws(()=>validate(obsolete,vtableGlobals,apis,handlers),/obsolete recipe/);
const alias=clone(apis);alias.find(a=>a.name==='IDirect3DVertexBuffer7_Lock').handler='wrong';
assert.throws(()=>validate(interfaces,vtableGlobals,alias,handlers),/alias mismatch/);
const absent=new Set(handlers);absent.delete('handle_IDirect3DVertexBuffer_Lock');
assert.throws(()=>validate(interfaces,vtableGlobals,apis,absent),/missing implementation/);
const reordered=clone(vtableGlobals);reordered[0].methods.reverse();
assert.throws(()=>validate(interfaces,reordered,apis,handlers),/vtable order/);
console.log(`PASS ${count} D3DIM interface methods, runtime targets, vtables and four negative controls`);
