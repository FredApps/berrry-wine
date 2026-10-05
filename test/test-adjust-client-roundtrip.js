#!/usr/bin/env node
'use strict';
// Actual USER geometry inverse: no host geometry overrides or corpus sizes.
const assert=require('node:assert/strict');
const path=require('node:path');
const {bootRenderHarness}=require('./render-helper');
const extraWat=String.raw`
(func (export "rt_register") (param $wc i32) (param $cls i32) (result i32)
 (local $sp i32) (local.set $sp (i32.load offset=16 (global.get $reg_base)))
 (call $gs32 (i32.add (local.get $wc) (i32.const 4)) (global.get $WNDPROC_BUILTIN))
 (call $gs32 (i32.add (local.get $wc) (i32.const 36)) (local.get $cls))
 (call $handle_RegisterClassA (local.get $wc) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
 (i32.store offset=16 (global.get $reg_base) (local.get $sp)) (i32.load (global.get $reg_base)))
(func (export "rt_adjust") (param $p i32) (param $style i32) (param $ex i32) (param $menu i32) (param $nonEx i32)
 (local $sp i32) (local.set $sp (i32.load offset=16 (global.get $reg_base)))
 (if (local.get $nonEx)
 (then (call $handle_AdjustWindowRect (local.get $p) (local.get $style) (local.get $menu) (i32.const 0) (i32.const 0) (i32.const 0)))
 (else (call $handle_AdjustWindowRectEx (local.get $p) (local.get $style) (local.get $menu) (local.get $ex) (i32.const 0) (i32.const 0))))
 (i32.store offset=16 (global.get $reg_base) (local.get $sp)))
(func (export "rt_create") (param $cls i32) (param $style i32) (param $ex i32) (param $cx i32) (param $cy i32) (param $sp i32) (param $menu i32) (result i32)
 (i32.store offset=16 (global.get $reg_base) (local.get $sp))
 (call $gs32 (local.get $sp) (i32.const 0))
 (call $gs32 (i32.add (local.get $sp) (i32.const 24)) (i32.const 10))
 (call $gs32 (i32.add (local.get $sp) (i32.const 28)) (local.get $cx))
 (call $gs32 (i32.add (local.get $sp) (i32.const 32)) (local.get $cy))
 (call $gs32 (i32.add (local.get $sp) (i32.const 36)) (i32.const 0))
 (call $gs32 (i32.add (local.get $sp) (i32.const 40)) (local.get $menu))
 (call $gs32 (i32.add (local.get $sp) (i32.const 44)) (global.get $image_base))
 (call $gs32 (i32.add (local.get $sp) (i32.const 48)) (i32.const 0))
 (call $handle_CreateWindowExA (local.get $ex) (local.get $cls) (i32.const 0) (local.get $style) (i32.const 10) (i32.const 0))
 (i32.load (global.get $reg_base)))
(func (export "rt_menu") (param $text i32) (result i32)
 (local $sp i32) (local $menu i32)
 (local.set $sp (i32.load offset=16 (global.get $reg_base)))
 (call $handle_CreateMenu (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
 (local.set $menu (i32.load (global.get $reg_base)))
 (call $handle_AppendMenuA (local.get $menu) (i32.const 0) (i32.const 101) (local.get $text) (i32.const 0) (i32.const 0))
 (i32.store offset=16 (global.get $reg_base) (local.get $sp)) (local.get $menu))
(func (export "rt_attach") (param $h i32) (param $menu i32) (param $cx i32) (param $cy i32)
 (local $sp i32) (local.set $sp (i32.load offset=16 (global.get $reg_base)))
 (call $handle_SetMenu (local.get $h) (local.get $menu) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
 (i32.store offset=16 (global.get $reg_base) (local.get $sp))
 (drop (call $move_window_core (local.get $h) (i32.const 0) (i32.const 10) (i32.const 10) (local.get $cx) (local.get $cy) (i32.const 0x1c) (i32.const 0))))
(func (export "rt_menu_count") (param $h i32) (result i32) (call $menu_bar_count (local.get $h)))
(func (export "rt_client") (param $h i32) (param $p i32)
 (local $sp i32) (local.set $sp (i32.load offset=16 (global.get $reg_base)))
 (call $handle_GetClientRect (local.get $h) (local.get $p) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))
 (i32.store offset=16 (global.get $reg_base) (local.get $sp)))
`;
(async()=>{
 const {exports:e}=await bootRenderHarness({extraWat,fonts:'none'});
 const cls=e.guest_alloc(16)>>>0;Buffer.from('Roundtrip\0').forEach((v,i)=>e.guest_write8(cls+i,v));
 const wc=e.guest_alloc(40)>>>0;for(let i=0;i<40;i+=4)e.guest_write32(wc+i,0);
 assert(e.rt_register(wc,cls),'registered generic default-procedure class');
 const rows=[];
 // Arbitrary dimensions, unrelated to any corpus title. Same invariant for
 // supported fixed caption, sizing caption and client-edge variants.
 for(const style of [0x10c00000,0x10c40000,0x10000000])for(const ex of [0,0x200])for(const [w,h]of [[237,139],[511,283]])for(const nonEx of (ex?[false]:[false,true]))for(const hasMenu of (style===0x10000000?[false]:[false,true])){
  const p=e.guest_alloc(32)>>>0,sp=(e.guest_alloc(1024)>>>0)+768;
  [0,0,w,h].forEach((v,i)=>e.guest_write32(p+4*i,v));e.rt_adjust(p,style,ex,hasMenu?1:0,nonEx?1:0);
  const r=Array.from({length:4},(_,i)=>e.guest_read32(p+i*4)|0);
  const menu=hasMenu?e.rt_menu(cls):0;
  const hwnd=e.rt_create(cls,style,ex,r[2]-r[0],r[3]-r[1],sp,menu)>>>0;
  if(hasMenu)e.rt_attach(hwnd,menu,r[2]-r[0],r[3]-r[1]);
  assert.equal(e.rt_menu_count(hwnd)>0,hasMenu,"actual attached menu presence");
  assert(hwnd,'actual CreateWindowExA succeeds');e.rt_client(hwnd,p+16);
  const actual=[e.guest_read32(p+24)-e.guest_read32(p+16),e.guest_read32(p+28)-e.guest_read32(p+20)];
  rows.push({style:style>>>0,ex,nonEx,hasMenu,requested:[w,h],adjusted:r,hwnd,actual});
 }
 console.log(JSON.stringify(rows,null,2));
 for(const row of rows)assert.deepEqual(row.actual,row.requested,'AdjustWindowRectEx -> CreateWindowExA -> GetClientRect roundtrip '+JSON.stringify(row));
 console.log('PASS geometry API roundtrip: '+rows.length+' cases');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
