#!/usr/bin/env node
'use strict';
// Send a text message to the owner's Telegram chat.
// Usage: node ops/telegram-send.js "<text>"   (or pipe the text on stdin)
// Uses the same bot token and owner chat as ops/telegram.js.
const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
  let text=process.argv.slice(2).join(' ');
  if(!text){const chunks=[];for await(const c of process.stdin)chunks.push(c);text=Buffer.concat(chunks).toString('utf8');}
  text=text.trim();if(!text)throw Error('usage: telegram-send.js "<text>"');
  const token=(await fs.readFile(process.env.TELEGRAM_TOKEN_FILE||path.join(root,'scratch/telegram-token.txt'),'utf8')).trim();
  if(!/^\d+:[A-Za-z0-9_-]+$/.test(token))throw Error('Invalid bot token file');
  const state=JSON.parse(await fs.readFile(path.join(root,'scratch/telegram/state.json'),'utf8'));
  const chatId=state.owner&&state.owner.chatId;if(!chatId)throw Error('No owner chat in scratch/telegram/state.json');
  for(let i=0;i<text.length;i+=4000){
    const response=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:text.slice(i,i+4000)}),signal:AbortSignal.timeout(30000)});
    const data=await response.json();if(!data.ok)throw Error('sendMessage failed ('+response.status+'): '+(data.description||''));
    console.log(JSON.stringify({messageId:data.result.message_id}));
  }
})().catch(e=>{console.error(e.message);process.exitCode=1});
