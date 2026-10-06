'use strict';
// Deterministic contract fixture; raw chronology regression remains private.
// Reviewed raw SHA fbad6dd8b0b8bea78ab42b9ca08acab75e697bb0135ee5c3d6c0a2a6d6c30c36.
const {PLAN}=require('./icy-tower-frame-counter');
const clone=x=>JSON.parse(JSON.stringify(x));
const origins=[{origin:1,contextToken:2,recordToken:3,owner:true,handle:0,tid:0,startAddr:0,param:0,state:'active'},{origin:4,contextToken:5,recordToken:6,owner:false,handle:10,tid:1,startAddr:0x60393e,param:0x63fb0c,state:'active'}];
function fixture() {
  const target={surfaceId:0x200004,hwnd:98305,objectToken:2,windowToken:3,paletteWa:2529516,com:0x8009020,width:640,height:480,directDraw:true};
  const state={sourceBitmap:0x6968c4,screenBitmap:0x652924,dibWa:0x1c000000,pitch:640,mode:0,paletteEffect:0,selected64:0,selectedIndex:831,selectedObject:0x6ee064,dimensions:[640,480,640,480],clip:[0,640,0,480],bpp:8,descriptorErrors:0,sourceFlags:0,screenFlags:0x84000000,target,
    callbacks:{sourceRow:0x46c000,screenRow:0x487d50,sourceCleanup:0x46c008,screenCleanup:0x487d68,copy:0x489568,acquire:0x485cf8,release:0x485f0c},
    sourceRows:Array.from({length:480},(_,i)=>({va:0x700000+i*640,wa:0x30000000+i*640,bytes:640,mapped:true})),
    destinationRows:Array.from({length:480},(_,i)=>({va:0x5009d000+i*640,wa:0x1c000000+i*640,bytes:640,mapped:true}))};
  const checkpoints=PLAN.checkpoints.map(([kind,rva],i)=>({origins:clone(origins),kind,eip:0x400000+rva,base:0x400000,origin:1,halt:5,t:i*100,markerCount:i?21:20,markerAddress:0x40f857,markerPace:0,eax:0,state:{...clone(state),depth:i>=1&&i<=3?1:0},args:[state.sourceBitmap,state.screenBitmap,0,0,0,0,640,480],returnAddress:0x450268,outerOutputReturn:0x40f857}));
  return {checkpoints,transfers:[{kind:'lock',t:50,endT:60,rect:0,returnAddress:0x485de8},{kind:'unlock',t:320,endT:325,rect:0,returnAddress:0x485f6d,outerReturn:0x40f857},{kind:'present',t:330,endT:335,dibWa:state.dibWa,bpp:8},{kind:'upload',t:340,endT:360,ok:1,rect:[0,0,640,480],bitsWa:state.dibWa,paletteWa:target.paletteWa}].map((x,i)=>({...x,sequence:i+1,origin:1,target})),proof:{exeSha256:PLAN.exeSha256,wasmSha256:PLAN.wasmSha256,mappedSha256:PLAN.mappedSha256,loadedBytesVerified:true,liveCodeVerified:true,observerSha256:'a'.repeat(64),sourceReceiptSha256:'b'.repeat(64)},errors:[],dropped:0,enclosure:{observerOwned:true,origins:clone(origins),stopOrigins:clone(origins)},sceneReview:{continuousGameplay:true,ordinaryInput:true},counterReview:{accepted:true}};
}
module.exports={fixture,origins};
