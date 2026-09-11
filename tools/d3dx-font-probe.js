#!/usr/bin/env node
'use strict';
// Native D3DX DLL -> guest GDI glyphs -> D3D textures -> software worker pixels.
// Requires Zig and a user-supplied Microsoft d3dx9_25.dll; no DLL is bundled.
const fs=require('fs'),path=require('path'),os=require('os');
const {spawn}=require('child_process');
const {PNG}=require('pngjs');
const root=path.resolve(__dirname,'..');
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
async function run(command,args,env=process.env) {
  const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
  const guard=setTimeout(()=>child.kill('SIGTERM'),120000);
  try {
    const status=await new Promise((resolve,reject)=>{
      child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));
    });
    if(status.code!==0)throw Error(`${command} failed ${JSON.stringify(status)}\n${output}`);
    return output;
  } finally {clearTimeout(guard);}
}
(async()=>{
  const dll=arg('dll'),wasm=arg('wasm');
  if(!dll||!wasm)throw Error('usage: node tools/d3dx-font-probe.js --dll=/path/d3dx9_25.dll --wasm=/path/current.wasm');
  fs.accessSync(dll);fs.accessSync(wasm);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'d3dx-font-probe-'));
  const exe=path.join(directory,'probe.exe'),png=path.join(directory,'frame.png');
  const zig=JSON.parse(await run('zig',['env']));
  await run('zig',['cc','-target','x86-windows-gnu','-march=i386','-fno-builtin',
    '-fno-stack-protector','-nostdlib','-isystem',path.join(zig.lib_dir,'libc/include/any-windows-any'),
    'tools/probes/d3dx-font.c','-Wl,--entry,WinMainCRTStartup','-Wl,--subsystem,windows',
    '-Wl,--major-os-version,4','-Wl,--minor-os-version,0',
    '-Wl,--major-subsystem-version,4','-Wl,--minor-subsystem-version,0',
    '-lkernel32','-luser32','-lgdi32','-o',exe],
    {...process.env,ZIG_LOCAL_CACHE_DIR:path.join(directory,'zig-local'),
      ZIG_GLOBAL_CACHE_DIR:path.join(root,'.cache/v86-reference/zig-global')});
  const log=await run(process.execPath,['test/run.js',`--exe=${exe}`,`--dll-seed=${path.resolve(dll)}`,
    '--d3d9-renderer=software','--d3d9-programmable',`--wasm=${path.resolve(wasm)}`,
    '--no-build','--quiet-api','--quiet-blocks','--max-seconds=45',
    '--max-batches=1000000','--batch-size=200000',`--png=${png}`]);
  fs.writeFileSync(path.join(directory,'run.log'),log);
  if(!log.includes('[Exit] code=0')||/\*\*\* CRASH/.test(log))throw Error(`guest did not finish successfully: ${directory}`);
  const frame=PNG.sync.read(fs.readFileSync(png));
  let white=0,blue=0;
  for(let i=0;i<frame.data.length;i+=4){
    const [r,g,b]=frame.data.subarray(i,i+3);
    if(r>220&&g>220&&b>220)white++;
    if(r===32&&g===64&&b===128)blue++;
  }
  const result={directory,width:frame.width,height:frame.height,white,blue};
  console.log(JSON.stringify(result));
  if(frame.width!==320||frame.height!==160||white<20||blue<40000)
    throw Error('native D3DX font failed canonical text-pixel acceptance');
  console.log('PASS native D3DX font -> GDI glyph upload -> software worker text pixels');
})().catch(error=>{console.error(error);process.exitCode=1;});
