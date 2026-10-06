'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createBot,hash}=require('./telegram-core');
const {chatReady,hasCodexChild,chatSubmitKey}=require('./telegram-guard');
const prompt={id:'a'.repeat(48),terminalId:'orchestrator',prompt:'Exact command: echo hello',sent:false};
function fixture(){const state={owner:{userId:10,chatId:10}},calls=[],actions=[];let live=prompt;
 const bot=createBot({state,save:async()=>{},telegram:async(method,body)=>{calls.push({method,body});return {message_id:20};},local:async(url,body)=>{if(url==='/api/state')return {tasks:[],approvals:{items:live?[live]:[]}};actions.push({url,body});return {sent:true};}});
 return {state,bot,calls,actions,live:p=>live=p};}
const message=(text,id=10,type='private')=>({message:{text,date:Date.now()/1000,from:{id},chat:{id,type}}});
test('/blockers matches dashboard grouping and stays read-only for authorized users',async()=>{
 const snapshot={tasks:[
  {id:'root',title:'Restore game files',status:'blocked',line:1,needs:'Restore archive',blocker:'Files absent',owner:'codex:one'},
  {id:'child',title:'Verify game',status:'blocked',line:2,dependencies:['root']},
  {id:'done',title:'Old blocker',status:'done',blocker:'Resolved'},
  {id:'review',title:'Review validation',status:'blocked',line:3,waitingOn:'Automated review',blocker:'Review stopped execution'},
 ],approvals:{items:[{reason:'Check exact command',terminalId:'orchestrator'},{reason:'Old approval',sent:true}]},terminals:[{agentId:'codex:one',label:'Fixture owner'}]};
 const calls=[],reads=[],state={owner:{userId:10,chatId:10}};
 const bot=createBot({state,save:async()=>{},telegram:async(method,body)=>{calls.push({method,body});return{};},local:async(url,body)=>{assert.equal(body,undefined);reads.push(url);return snapshot;}});
 await bot.handle(message('/blockers',11));await bot.handle(message('/blockers',10,'group'));
 assert.equal(reads.length,0);
 await bot.handle(message('/blockers@wine_bot'));
 assert.deepEqual(reads,['/api/state']);assert.equal(state.chatQueue,undefined);
 const text=calls.map(x=>x.body.text).join('\n');
 assert.match(text,/1 live approvals · 2 primary blockers · 1 dependent tasks/);
 assert.match(text,/Next: Restore archive/);assert.match(text,/Reason: Files absent/);assert.match(text,/Owner: Fixture owner/);
 assert.match(text,/Also holds up: Verify game \[child\]/);assert.match(text,/No dashboard override/);
 assert(!text.includes('Old blocker'));assert(!text.includes('Old approval'));
 assert.match(text,/1 need your input · 1 agent-resolvable/);assert.match(text,/NEEDS YOUR INPUT\n\nReview validation \[review\]/);assert.match(text,/AGENT-RESOLVABLE\n\nRestore game files \[root\]/);assert.match(text,/Who: No waitingOn recorded/);
});
test('/blockers empty state and command menu/help share the command catalog',async()=>{
 const f=fixture();f.live(null);await f.bot.handle(message('/blockers'));
 assert.match(f.calls.at(-1).body.text,/No blocked tasks recorded/);
 await f.bot.handle(message('/help'));
 const {COMMANDS}=require('./telegram-core');
 assert(COMMANDS.some(x=>x.command==='blockers'));
 for(const c of COMMANDS)assert(f.calls.at(-1).body.text.includes('/'+c.command+' — '+c.description));
 assert.equal(f.actions.length,0);
});
test('Remote Codex capitalized model footer permits an empty prompt and exact chat submission',()=>{
 assert(chatReady('› Ask Codex to do anything\n\n  GPT-6-Astra medium · ~/wine-assembly'));
 assert.equal(chatSubmitKey('› [Telegram] hello\n\n  GPT-6-Astra medium · ~/wine-assembly','[Telegram] hello'),'Enter');
 assert(!chatReady('› existing draft\n\n  GPT-6-Astra medium'));
});
test('Telegram ignores other users and groups; chat never becomes a direct approval',async()=>{const f=fixture();await f.bot.handle(message('hello',11));await f.bot.handle(message('hello',10,'group'));assert.equal(f.actions.length,0);await f.bot.handle(message('yes'));assert.equal(f.actions[0].url,'/api/orchestrator-chat');assert.equal(f.actions[0].body.message,'yes');});
test('Pairing requires secret, expiry, private account; only one owner',async()=>{const f=fixture();delete f.state.owner;f.state.pairing={hash:hash('f'.repeat(32)),expires:Date.now()+1000};await f.bot.handle(message('/start '+'e'.repeat(32)));assert(!f.state.owner);await f.bot.handle(message('/start '+'f'.repeat(32)));assert.equal(f.state.owner.userId,10);assert.match(f.calls[0].body.text,/Hi!/);await f.bot.handle(message('/start '+'f'.repeat(32),11));assert.equal(f.state.owner.userId,10);});
test('Approval binds user/message/exact prompt, consumes before dispatch and rejects replay',async()=>{const f=fixture();await f.bot.notifyApproval(prompt);const cb={callback_query:{id:'q',from:{id:10},message:{message_id:20,chat:{id:10,type:'private'}},data:'a:'+prompt.id}};await f.bot.handle({...cb,callback_query:{...cb.callback_query,from:{id:11}}});assert.equal(f.actions.length,0);await f.bot.handle(cb);assert.equal(f.actions.length,1);assert.deepEqual(f.actions[0].body,{id:prompt.id,decision:'accept'});await f.bot.handle(cb);assert.equal(f.actions.length,1);});
test('Changed and expired prompts cannot be approved',async()=>{const f=fixture();await f.bot.notifyApproval(prompt);f.live({...prompt,prompt:'Different command'});await f.bot.handle({callback_query:{id:'q',from:{id:10},message:{message_id:20,chat:{id:10,type:'private'}},data:'a:'+prompt.id}});assert.equal(f.actions.length,0);});
test('Chat guard rejects shells, drafts and approval menus; process ancestry must match',()=>{assert(chatReady('Working\n› Ask Codex to do anything\n gpt-6-astra medium · project'));assert(!chatReady('$ shell\n'));assert(!chatReady('› unfinished draft\n gpt-6-astra'));assert(!chatReady('Would you like to run the following command?\n› Ask Codex to do anything\n gpt-6-astra'));assert(hasCodexChild('100 1 node\n101 100 /vendor/bin/codex',100));assert(!hasCodexChild('100 1 node\n101 2 /vendor/bin/codex',100));});
test('Pairing expires but an unchanged live approval remains usable after ten minutes',async()=>{
 const f=fixture();delete f.state.owner;f.state.pairing={hash:hash('f'.repeat(32)),expires:Date.now()-1000};
 await f.bot.handle(message('/start '+'f'.repeat(32)));assert(!f.state.owner);
 f.state.owner={userId:10,chatId:10};await f.bot.notifyApproval(prompt);f.state.pending.expires=Date.now()-1000;
 await f.bot.handle({callback_query:{id:'q',from:{id:10},message:{message_id:20,chat:{id:10,type:'private'}},data:'a:'+prompt.id}});
 assert.equal(f.actions.length,1);
});
test('Plain start explains pairing without granting access',async()=>{
 const f=fixture();delete f.state.owner;
 await f.bot.handle(message('/start'));
 assert(!f.state.owner);assert.equal(f.actions.length,0);
 assert.match(f.calls[0].body.text,/not paired yet/);
 assert.equal(f.calls[0].body.chat_id,10);
});
test('Chat submission follows the busy queue footer and requires the exact draft',()=>{
 const busy='Working\n› [Telegram] status\n\n  tab to queue message 69% context left';
 assert.equal(chatSubmitKey(busy,'[Telegram] status'),'Tab');
 assert.equal(chatSubmitKey(busy,'different draft'),null);
 assert.equal(chatSubmitKey('Would you like to run the following command?\n'+busy,'[Telegram] status'),null);
 assert.equal(chatSubmitKey('› [Telegram] status\n\n gpt-6-astra medium','[Telegram] status'),'Enter');
});
test('Approval dedup survives dashboard IDs changing; callback resolves fresh ID',async()=>{
 const f=fixture();await f.bot.notifyApproval(prompt);
 const changed={...prompt,id:'b'.repeat(48)};f.live(changed);await f.bot.notifyApproval(changed);
 assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,1);
 await f.bot.handle({callback_query:{id:'q',from:{id:10},message:{message_id:20,chat:{id:10,type:'private'}},data:'a:'+prompt.id}});
 assert.equal(f.actions[0].body.id,changed.id);
});
test('Approval identity ignores background output but preserves command spaces',()=>{
 const {parseApproval,approvalIdentity}=require('./approval-prompt');
 const p="Would you like to run the following command?\n\n$ echo 'a  b'\n\n› 1. Yes, proceed (y)\n2. No, and tell Codex what to do differently (esc)\n\nPress enter to confirm or esc to cancel";
 assert.equal(approvalIdentity(parseApproval('old progress\n'+p).prompt),approvalIdentity(parseApproval('new progress\n'+p).prompt));
 assert.notEqual(approvalIdentity(p),approvalIdentity(p.replace('a  b','a b')));
});
test('Persistent approval is offered only for the observed rule option',async()=>{
 const f=fixture();await f.bot.notifyApproval(prompt);
 assert.equal(f.calls[0].body.reply_markup.inline_keyboard.flat().length,2);
 f.state.notified=null;const p={...prompt,allowRule:true};f.live(p);await f.bot.notifyApproval(p);
 assert.equal(f.calls.filter(c=>c.method==='sendMessage').at(-1).body.reply_markup.inline_keyboard.flat().length,3);
 await f.bot.handle({callback_query:{id:'q',from:{id:10},message:{message_id:20,chat:{id:10,type:'private'}},data:'p:'+prompt.id}});
 assert.equal(f.actions[0].body.decision,'allow-rule');
});
test('Direct final replies persist failures, resume chunks and deduplicate',async()=>{
 const {enqueue,flush}=require('./telegram-replies'),state={telegramActiveTurn:true};let saved=0,sent=[];
 const record={type:'response_item',payload:{type:'message',id:'m1',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Status '+ 'x'.repeat(4000)}]}};
 enqueue(state,record);enqueue(state,record);assert.equal(state.replyQueue.length,1);
 const save=async()=>{saved++;};let attempts=0;
 await flush(state,save,async text=>{if(++attempts===2)throw Error('offline');sent.push(text);return {message_id:1};},()=>100);
 assert.equal(state.replyQueue[0].next,1);assert.equal(sent.length,1);assert(saved>0);
 const restored=JSON.parse(JSON.stringify(state));await flush(restored,save,async text=>{sent.push(text);return {message_id:2};},()=>20000);
 assert.equal(restored.replyQueue.length,0);assert.equal(sent.length,2);
 enqueue(restored,record);assert.equal(restored.replyQueue.length,0);
 enqueue(restored,{...record,payload:{...record.payload,id:'analysis',phase:'analysis'}});assert.equal(restored.replyQueue.length,0);
});
test('Quiet delivery suppresses routine progress and autonomous finals, preserves direct answers and explicit milestones',()=>{
 const {enqueue,formatChunks}=require('./telegram-replies'),s={};
 const user=(text,turn)=>({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}],internal_chat_message_metadata_passthrough:{turn_id:turn}}});
 const answer=(id,phase,turn,text='Answer')=>({type:'response_item',payload:{type:'message',id,role:'assistant',phase,content:[{type:'output_text',text}],internal_chat_message_metadata_passthrough:{turn_id:turn}}});
 enqueue(s,user('[Telegram] status','direct'));enqueue(s,answer('p','commentary','direct'));
 enqueue(s,answer('a','final_answer','direct'));assert.equal(s.replyQueue.length,1);assert.equal(s.replyQueue[0].chunks[0].text,'Answer');
 enqueue(s,user('Continue goal','background'));enqueue(s,answer('b','final_answer','background'));assert.equal(s.replyQueue.length,1);
 enqueue(s,answer('c','final_answer','background','[Telegram update] Task completed.'));assert.equal(s.replyQueue.length,2);
 const chunks=formatChunks('Status\n```text\nRUNNING  Game\n```\nNext.');
 assert(!chunks[0].text.includes('```'));const e=chunks[0].entities[0];assert.equal(chunks[0].text.slice(e.offset,e.offset+e.length),'RUNNING  Game\n');
 enqueue(s,answer('heading','final_answer','direct','Orchestrator\n\nShort answer.'));
 assert.equal(s.replyQueue.at(-1).chunks[0].text,'Short answer.');
});
test('Approvals format exact commands and rules as code and omit terminal keyboard instructions',()=>{
 const {approval,chunks}=require('./telegram-format');
 const command="ssh example 'echo <hello> & exit 0'";
 const p={command,reason:'Run the check?',allowRule:true,prompt:"Would you like to run the following command?\n$ "+command+"\n› 1. Yes, proceed (y)\n2. Yes, and don't ask again for commands that start with `ssh example` (p)\n3. No, and tell Codex what to do differently (esc)\nPress enter to confirm"};
 const part=approval(p)[0];
 assert(!part.text.includes('Press enter'));assert(!part.text.includes('1. Yes'));
 const code=part.entities.filter(e=>e.type==='pre').map(e=>part.text.slice(e.offset,e.offset+e.length));
 assert.equal(code[0],command);assert.match(code[1],/`ssh example`/);
 const long='😀'+ '<&'.repeat(4000);const parts=chunks([{text:long,type:'pre'}]);
 assert.equal(parts.map(p=>p.text).join(''),long);assert(parts.every(p=>p.text.length<=3000&&p.entities[0].length===p.text.length));
});
test('An existing approval is reformatted in place without another notification',async()=>{
 const f=fixture();await f.bot.notifyApproval(prompt);delete f.state.pending.formatVersion;
 await f.bot.notifyApproval(prompt);
 assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,1);
 assert.equal(f.calls.filter(c=>c.method==='editMessageText').length,1);
});
test('Chat waits durably on explicit pre-input rejection, then delivers once',async()=>{
 const state={owner:{userId:10,chatId:10}},messages=[];let blocked=true,attempts=0;
 const make=()=>createBot({state,save:async()=>{},telegram:async(method,body)=>{messages.push(body.text);return {};},local:async()=>{attempts++;if(blocked)throw Object.assign(Error('Orchestrator has a prompt or draft open. Resolve it before sending chat'),{status:409});return {sent:true};}});
 await make().handle(message('capture next game'));assert.equal(state.chatQueue.length,1);assert(!state.chatAttempt);
 const restarted=make();blocked=false;await restarted.drainChat();await restarted.drainChat();
 assert.equal(state.chatQueue.length,0);assert.equal(attempts,2);assert.equal(state.lastChat.text,'capture next game');
});
test('Ambiguous delivery is never replayed, and waiting messages can be cancelled',async()=>{
 const state={owner:{userId:10,chatId:10}};let attempts=0;
 const bot=createBot({state,save:async()=>{},telegram:async()=>({}),local:async()=>{attempts++;throw Error('timeout');}});
 await bot.handle(message('hello'));await bot.drainChat();assert.equal(attempts,1);assert.equal(state.chatQueue.length,0);
 state.chatQueue=[{text:'waiting',at:Date.now()}];await bot.handle(message('/cancel'));assert.equal(state.chatQueue.length,0);
 state.chatAttempt={text:'possibly sent'};await bot.drainChat();assert(!state.chatAttempt);assert.equal(attempts,1);
});
test('Successful chat uses typing instead of a queued reply and stops after the answer or approval',async()=>{
 const state={owner:{userId:10,chatId:10}},calls=[];let time=Date.now();
 const bot=createBot({state,now:()=>time,save:async()=>{},local:async()=>({sent:true}),telegram:async(method,body)=>{calls.push({method,body});return {};}});
 await bot.handle(message('check the game screenshots'));assert.equal(calls.length,1);assert.equal(calls[0].method,'sendChatAction');assert.equal(calls[0].body.action,'typing');
 await bot.typing();assert.equal(calls.length,1);
 time+=4000;await bot.typing();assert.equal(calls.length,2);
 state.pending={};time+=4000;await bot.typing();assert.equal(calls.length,2);
 state.pending=null;state.lastDirectReplyAt=time;await bot.typing();assert.equal(calls.length,2);
 state.lastDirectReplyAt=0;time+=11*60000;await bot.typing();assert.equal(calls.length,2);
});
test('Status questions reply from dated dashboard state without touching a busy terminal',async()=>{
 const calls=[],requests=[],state={owner:{userId:10,chatId:10}};
 const bot=createBot({state,save:async()=>{},telegram:async(method,body)=>{calls.push({method,body});return {message_id:42};},local:async url=>{requests.push(url);assert.equal(url,'/api/state');return {tasks:[],projectStatus:{available:true,body:'Checking gameplay screenshots.',updatedAt:'2026-10-03T09:00:00Z'}};}});
 for(const text of ["whtas' latest",'sup','/status','ascii art tldr status'])await bot.handle(message(text));
 assert.equal(requests.length,4);assert.equal(calls.length,4);
 assert(calls.every(c=>c.method==='sendMessage'&&c.body.text.includes('TASK STATUS')&&c.body.text.includes('2026-10-03 09:00 UTC')));
 assert.equal(calls[3].body.entities[0].type,'pre');
 assert.equal(calls[3].body.entities[0].length,calls[3].body.text.length);
 assert(!calls[0].body.entities);
 assert.equal(state.chatQueue,undefined);assert.equal(state.lastStatusDelivery.messageId,42);
});
test('TLDR stays bounded for a large ledger and never dumps STATUS prose',()=>{
 const {statusText}=require('./telegram-status');
 const snapshot={tasks:Array.from({length:200},(_,i)=>({status:i<10?'active':'blocked',title:'Gameplay qualification '.repeat(20)})),candidates:[],projectStatus:{body:'SECRET_LONG_PROSE'.repeat(100)}};
 const text=statusText(snapshot,{ascii:true});
 assert(text.length<1100);assert(!text.includes('SECRET_LONG_PROSE'));
 assert.match(text,/ACTIVE  10/);assert.match(text,/BLOCKED 190/);
 assert(text.split('\n').every(line=>line.length===50));
});
test('Busy terminal keeps actionable chat queued with typing, without Saved chatter',async()=>{
 const calls=[],state={owner:{userId:10,chatId:10}};
 const bot=createBot({state,save:async()=>{},telegram:async(method,body)=>{calls.push({method,body});return {};},local:async()=>{const e=Error('Orchestrator has a prompt or draft open.');e.status=409;throw e;}});
 await bot.handle(message('capture the next game'));
 assert.equal(state.chatQueue.length,1);assert.deepEqual(calls.map(c=>c.method),['sendChatAction']);
});
