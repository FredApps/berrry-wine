'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict');
const {install}=require('./observer');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const source=path.resolve(__dirname,'../../../scratch/dredmor-fps-20261005/attempt4/served/lib')+'/';
const pins=require('../../release-evidence/dredmor-presentation-audit-20261005/source.json').hashes;
for(const name of ['guest-rpc.js','surface.js'])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source+name)).digest('hex'),pins['lib/'+name],'Pinned actual-source fixture drift');
const {CanvasSurface}=require(source+'surface');
const RPC=require(source+'guest-rpc');
function fixture(){
 const drawn=[],canvas={width:10,height:10},ctx={drawImage(...args){drawn.push(args);},globalAlpha:1};
 const surface=new CanvasSurface({width:100,height:100,getContext:()=>ctx});
 const p={canvas,flushCount:0};let dirty=0,visible=true;const marker={};
 const renderer={surface,_repaintOnce(...args){assert.equal(this,renderer);if(dirty){p.flushCount++;dirty=0;}surface.blit({canvas},0,0,10,10,0,0,10,10);return marker;}};
 const broker=RPC.createMainBroker({buffer:new SharedArrayBuffer(RPC.RPC_BASE+RPC.RPC_STRIDE*2)},()=>({gdi_surface_upload(){dirty++;return 1;}}),{gdi_surface_upload:{params:[],results:[]}});
 const ob=install({renderer,presentation:p,inspect:()=>visible,clock:()=>1});
 return{ob,p,renderer,surface,ctx,canvas,drawn,marker,upload(n=1,slot=0){broker.serveCalls({slot,list:Array.from({length:n},()=>[0,[1,0,0,10,10]]).flat()});},hide(){visible=false;}};
}
test('real broker batches coalesce to one real CanvasSurface composition; unchanged repaint zero',()=>{const f=fixture();f.upload(3);assert.equal(f.renderer._repaintOnce('arg'),f.marker);assert.equal(f.drawn.length,1);assert.equal(f.ob.result.count,1);f.renderer._repaintOnce();assert.equal(f.ob.result.count,1);f.upload();f.renderer._repaintOnce();assert.equal(f.ob.result.count,2);f.ob.stop();});
test('hidden/overlay eligibility prevents counting; no draw means zero',()=>{const f=fixture();f.hide();f.upload();f.renderer._repaintOnce();assert.equal(f.ob.result.count,0);f.ob.stop();});
test('real CanvasSurface thrown draw error preserved with no count',()=>{const f=fixture(),error=Error('draw');f.ctx.drawImage=()=>{throw error;};f.upload();assert.throws(()=>f.renderer._repaintOnce(),e=>e===error);assert.equal(f.ob.result.count,0);f.ob.stop();});
test('foreign target and surface replacement never qualify',()=>{const f=fixture();f.p.canvas={};f.upload();f.renderer._repaintOnce();assert.equal(f.ob.result.count,0);f.ob.stop();});
test('wrapper preserves exact receiver,args,return and promise identity; no async qualification',()=>{const p={canvas:{},flushCount:0},args=[1,2],receiver={};let seen;const promise=Promise.resolve(3);const surface={blit:function(...a){seen={self:this,args:a};return promise;}},renderer={surface,_repaintOnce:function(...a){seen={self:this,args:a};return promise;}};const o=install({renderer,presentation:p,inspect:()=>true});assert.equal(renderer._repaintOnce.apply(receiver,args),promise);assert.equal(seen.self,receiver);assert.deepEqual(seen.args,args);assert.equal(o.result.count,0);o.stop();});
test('cleanup does not overwrite foreign replacements',()=>{const f=fixture(),foreign=()=>{};f.renderer._repaintOnce=foreign;f.ob.stop();assert.equal(f.renderer._repaintOnce,foreign);assert(f.ob.result.errors.includes('foreign repaint replacement'));});
