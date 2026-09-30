#!/usr/bin/env node
'use strict';
// Verify the actual ESSL1/ESSL3 paths; the native GPU test uses desktop GLSL.
const assert = require('assert');
const path = require('path');
const puppeteer = require('puppeteer');
(async () => {
  const args = ['--no-first-run', '--no-default-browser-check'];
  if (process.argv.includes('--no-sandbox')) args.push('--no-sandbox');
  if (process.argv.includes('--swiftshader')) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args
  });
  try {
    const page = await browser.newPage();
    for (const file of ['surface.js', 'renderer.js', 'gpu-backend.js', 'glide-backend.js', 'glide-host.js'])
      await page.addScriptTag({ path: path.join(__dirname, '../lib', file) });
    const results = await page.evaluate(() => {
      const results = [];
      for (const version of [1, 2]) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const backend = new GpuBackend.WebGLBackend(canvas, { apiVersion: version });
        const device = new GlideBackend.Device({ backend });
        const packet = values => new Uint8Array(new Uint32Array(values).buffer);
        try {
          device.submit(1, packet([1, 32, 32, 0, 0]));
          device.submit(3, packet([0, 255, 65535]));
          const upload = new Uint8Array(36);
          upload.set(packet([0, 7, 7, 3, 10, 3, 8]));
          upload.set([0, 248, 224, 7, 31, 0, 255, 255], 28);
          device.submit(6, upload);
          const draw = new Uint8Array(436);
          const state = new Uint32Array(draw.buffer, 0, 64);
          const values = { 0:3,1:8,3:1,5:1,11:2,12:1,13:1,14:4,16:4,18:7,
            28:32,29:32,30:1,31:1,33:7,34:7,35:3,36:10,37:3,38:1,39:1,42:1,45:1,46:1,48:1,61:1 };
          for (const [index,value] of Object.entries(values)) state[index]=value;
          const view = new DataView(draw.buffer);
          for (let i=0;i<3;i++) {
            const xy=[[0,0],[32,0],[0,32]][i];
            const vertex=[...xy,0,255,255,255,1,255,0.5,i===1?4096:0,i===2?4096:0,0.5,0,0,0];
            vertex.forEach((value,j)=>view.setFloat32(256+i*60+j*4,value,true));
          }
          device.submit(5, draw);
          const pixels = new Uint8Array(4), gl=backend.gl;
          backend.readPixels(4,27,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          const clamped=Array.from(pixels);
          state[0]=1;state[3]=0;
          for(let i=0;i<3;i++) {
            view.setFloat32(256+i*60+4*4,0,true);
            view.setFloat32(256+i*60+5*4,0,true);
            view.setFloat32(256+i*60+8*4,0.25,true);
          }
          device.submit(5,draw);
          backend.readPixels(4,27,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          const occluded=Array.from(pixels);
          device.submit(4,new Uint8Array());
          const published=Array.from(backend.getPresentationSurface().getContext('2d').getImageData(4,4,1,1).data);
          // W depth plus table fog must never consume the unused ooz field.
          // NFS II SE supplies NaNs here; test an independent expected color
          // as well as identical output for finite/nonfinite guest bytes.
          state[22]=2;state[23]=0xff0000ff;
          device.submit(8,new Uint8Array(64).fill(64));
          for(let i=0;i<3;i++) view.setFloat32(256+i*60+8*4,0.5,true);
          const unusedZ=[];
          for(const z of [12345,NaN,Infinity,-Infinity,2.1e36]) {
            device.submit(3,packet([0,255,65535]));
            for(let i=0;i<3;i++) view.setFloat32(256+i*60+6*4,z,true);
            device.submit(5,draw);
            backend.readPixels(4,27,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            unusedZ.push(Array.from(pixels));
          }
          // Explicit Z fog remains meaningful with W buffering: its raw Z
          // varying must survive even though geometry uses neutral clip Z.
          state[22]=3;
          const zFog=[];
          for(const z of [0,65535]) {
            device.submit(3,packet([0,255,65535]));
            for(let i=0;i<3;i++) view.setFloat32(256+i*60+6*4,z,true);
            device.submit(5,draw);
            backend.readPixels(4,27,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            zFog.push(Array.from(pixels));
          }
          // Exercise the actual presentation shaders in both ESSL versions.
          // DAC correction must change display pixels without touching the
          // render target or the RGB565 bytes returned through an LFB read.
          const displayPixel = () => Array.from(backend.getPresentationSurface()
            .getContext('2d').getImageData(4,4,1,1).data);
          device.submit(3,packet([0x404040,255,65535]));
          device.submit(4,new Uint8Array());
          device.submit(14,new Uint8Array(new Float32Array([2,1,.5]).buffer));
          const rgbGamma = displayPixel();
          const ramp = new Uint8Array(4+66*3);
          new DataView(ramp.buffer).setUint32(0,66,true);
          for(let c=0;c<3;c++) {
            ramp[4+c*66+64]=7+c;
            ramp[4+c*66+65]=211+c;
          }
          device.submit(13,ramp);
          const gammaTable = displayPixel();
          device.bind(0);
          backend.readPixels(4,27,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          const rawGamma = Array.from(pixels);
          const lfb = new Uint8Array(20+32*32*2);
          lfb.set(packet([0,0,0,32,32]));device.submit(9,lfb);
          const lfbGamma = new DataView(lfb.buffer).getUint16(20+(4*32+4)*2,true);
          device.bind(1);
          device.submit(3,packet([0xc8c8c8,255,65535]));device.submit(4,new Uint8Array());
          const untouchedGammaTail = displayPixel();
          device.submit(14,new Uint8Array(new Float32Array([1,1,1]).buffer));
          const gammaIdentity = displayPixel();
          results.push({version,clamped,occluded,published,unusedZ,zFog,rgbGamma,gammaTable,
            rawGamma,lfbGamma,untouchedGammaTail,gammaIdentity,error:gl.getError()});
        } finally { device.destroy();backend.destroy(); }
      }
      return results;
    });
    for (const result of results) {
      assert.deepStrictEqual(result.clamped,[255,255,255,255],`WebGL${result.version} truncated mip`);
      assert.deepStrictEqual(result.occluded,[255,255,255,255],`WebGL${result.version} W depth`);
      assert.deepStrictEqual(result.published,[255,255,255,255],`WebGL${result.version} published surface`);
      for(const pixels of result.unusedZ)
        assert.deepStrictEqual(pixels,[191,0,64,255],`WebGL${result.version} W mode ignores unused ooz`);
      assert.deepStrictEqual(result.zFog,[[255,0,0,255],[0,0,255,255]],`WebGL${result.version} W mode preserves Z fog`);
      assert.deepStrictEqual(result.rgbGamma,[128,64,16,255],`WebGL${result.version} independent RGB gamma`);
      assert.deepStrictEqual(result.gammaTable,[7,8,9,255],`WebGL${result.version} DAC uses exact nearest entries`);
      assert.deepStrictEqual(result.rawGamma,[64,64,64,255],`WebGL${result.version} DAC preserves render target`);
      assert.strictEqual(result.lfbGamma,0x4208,`WebGL${result.version} DAC preserves raw RGB565 LFB`);
      assert.deepStrictEqual(result.untouchedGammaTail,[226,200,157,255],`WebGL${result.version} partial upload preserves DAC tail`);
      assert.deepStrictEqual(result.gammaIdentity,[200,200,200,255],`WebGL${result.version} RGB correction replaces custom DAC`);
      assert.strictEqual(result.error,0);
    }
    const composed = await page.evaluate(async () => {
      const screen = document.createElement('canvas');screen.width=screen.height=96;
      const renderer = new Win98Renderer(screen);
      renderer.createWindow(1,0x90000000,8,8,32,32,'Glide only',0);
      const withoutBacking = !renderer.windows[1]._backCanvas;
      const memory = new ArrayBuffer(4096);
      const bridge = new GlideHost.Bridge({getMemory:()=>memory,renderer:()=>renderer,
        getExports:()=>({get_dx_present_hwnd:()=>1})});
      const send = (opcode,values) => {
        const bytes=new Uint8Array(new Uint32Array(values).buffer);
        new Uint8Array(memory).set(bytes);
        return bridge.submit(opcode,0,bytes.length);
      };
      // Exercise the host's real publication request. Calling repaint here
      // would hide a bridge that attaches a valid layer but never schedules
      // it for display, which was the final NFS integration regression.
      const scheduledFrame = async () => {
        await new Promise(resolve=>requestAnimationFrame(resolve));
        await new Promise(resolve=>requestAnimationFrame(resolve));
      };
      try {
        // Drain any window-creation repaint before the Glide frame exists,
        // so an unrelated queued repaint cannot make this test pass.
        await scheduledFrame();
        send(1,[0,32,32,0,0]);send(3,[0xff0000,255,65535]);send(4,[]);
        await scheduledFrame();
        const top=Array.from(screen.getContext('2d').getImageData(12,12,1,1).data);
        const backing=!!renderer.windows[1]._backCanvas;
        const attached=bridge.win?.hwnd;
        bridge.close();await scheduledFrame();
        const closed=Array.from(screen.getContext('2d').getImageData(12,12,1,1).data);
        // A GPU child has its own surface despite its ordinary Win32 parent.
        renderer.createWindow(2,0x50000000,4,4,16,16,'child',0);
        send(1,[2,16,16,0,0]);send(3,[0x00ff00,255,65535]);send(4,[]);
        await scheduledFrame();
        const child=Array.from(screen.getContext('2d').getImageData(16,16,1,1).data);
        return {withoutBacking,backing,attached,top,closed,child,childOwn:renderer.windows[2]._canonicalOwnSurface};
      } finally {bridge.close();}
    });
    assert(composed.withoutBacking && composed.backing,'Glide must allocate backing for GPU-only window');
    assert.strictEqual(composed.attached,1,'null Glide HWND resolves through process-owned HWND');
    assert.deepStrictEqual(composed.top,[255,0,0,255],'actual desktop compositor displays Glide');
    assert.deepStrictEqual(composed.closed,[192,192,192,255],'closed Glide layer disappears');
    assert(composed.childOwn,'Glide child owns its GPU surface');
    assert.deepStrictEqual(composed.child,[0,255,0,255],'actual desktop compositor displays GPU child');
    console.log('Glide WebGL1/WebGL2 mip/W-depth, gamma DAC and real window compositor PASS');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
