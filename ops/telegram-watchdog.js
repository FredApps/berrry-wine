#!/usr/bin/env node
'use strict';
const {fork}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs');
const dir=path.resolve(__dirname,'../scratch/telegram');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const lock=process.env.TELEGRAM_WATCHDOG_LOCK||path.join(dir,'watchdog.lock');
try{fs.mkdirSync(lock);}catch{console.error('Telegram watchdog lock exists; verify no watchdog is alive before removing it.');process.exit(1);}
fs.writeFileSync(path.join(lock,'pid'),String(process.pid));
let child,last=Date.now(),stopping=false,restartTimer,restarts=0;
function start(){if(stopping)return;last=Date.now();child=fork(path.join(__dirname,'telegram.js'),[],{stdio:['ignore','inherit','inherit','ipc']});console.log(new Date().toISOString()+' Telegram child PID '+child.pid);child.on('message',m=>{if(m?.type==='heartbeat')last=Date.now();});child.on('exit',()=>{if(stopping)return;restarts++;restartTimer=setTimeout(start,Math.min(30000,2000*restarts));});}
const timer=setInterval(()=>{
 fs.writeFileSync(path.join(dir,'watchdog.json'),JSON.stringify({pid:process.pid,childPid:child?.pid,lastHeartbeat:new Date(last).toISOString(),restarts}));
 if(child && Date.now()-last>60000){console.error('Telegram child unresponsive; restarting.');child.kill('SIGKILL');last=Date.now();}
},5000);
function stop(){if(stopping)return;stopping=true;clearInterval(timer);clearTimeout(restartTimer);child?.kill('SIGTERM');fs.rmSync(lock,{recursive:true,force:true});setTimeout(()=>process.exit(0),1000);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);start();
