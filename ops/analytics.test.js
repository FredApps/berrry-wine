'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createAccumulator,ingest,interval,cost,updateFile}=require('./analytics');
const day='2026-10-05',stamp=n=>`${day}T00:00:${String(n).padStart(2,'0')}.000Z`;
const agent=provider=>createAccumulator({id:provider+':one',provider});
const usage=(s,t,total)=>ingest(s,{timestamp:stamp(t),type:'event_msg',payload:{type:'token_count',info:{total_token_usage:total,last_token_usage:total}}});
test('Codex cumulative usage counts cache once, reasoning as a subset, and duplicate records zero times',()=>{
 const s=agent('codex');s.model='gpt-6-astra';const u={input_tokens:1000,cached_input_tokens:800,output_tokens:100,reasoning_output_tokens:40};
 usage(s,1,u);usage(s,2,u);usage(s,3,{input_tokens:1500,cached_input_tokens:1200,output_tokens:150,reasoning_output_tokens:60});
 assert.deepEqual(s.days[day].tokens,{input:300,read:1200,write:0,writeHour:0,output:150,reasoning:60});assert.equal(s.days[day].requests,2);
});
test('fork history establishes cumulative baseline without charging parent work to child',()=>{
 const s=createAccumulator({id:'codex:child',provider:'codex',startedAt:stamp(2)});
 usage(s,1,{input_tokens:1000,output_tokens:100});usage(s,3,{input_tokens:1100,output_tokens:120});assert.equal(s.days[day].tokens.input,100);assert.equal(s.days[day].tokens.output,20);
});
test('Claude streamed blocks share one request and one-hour writes remain separate',()=>{
 const s=agent('claude');const e={timestamp:stamp(1),type:'assistant',message:{id:'msg1',model:'claude-opus-4-6',usage:{input_tokens:10,cache_read_input_tokens:100,cache_creation_input_tokens:50,cache_creation:{ephemeral_1h_input_tokens:20},output_tokens:5}}};
 ingest(s,e);ingest(s,e);ingest(s,{...e,timestamp:stamp(2),message:{...e.message,usage:{...e.message.usage,output_tokens:12}}});
 assert.deepEqual(s.days[day].tokens,{input:10,read:100,write:30,writeHour:20,output:12,reasoning:0});assert.equal(s.days[day].requests,1);
});
test('tool and test intervals are exclusive; unexplained gaps become unknown; UTC midnight splits',()=>{
 const s=agent('codex');ingest(s,{timestamp:stamp(0),type:'event_msg',payload:{type:'task_started'}});
 ingest(s,{timestamp:stamp(2),type:'response_item',payload:{type:'function_call',call_id:'x',name:'exec_command',arguments:'node test/run.js'}});
 ingest(s,{timestamp:stamp(10),type:'response_item',payload:{type:'function_call_output',call_id:'x',output:'passed'}});
 ingest(s,{timestamp:stamp(12),type:'event_msg',payload:{type:'task_complete'}});
 assert.equal(s.days[day].ms.tests,8000);assert.equal(s.days[day].ms.model,4000);
 interval(s,Date.parse('2026-10-04T23:59:00Z'),Date.parse('2026-10-05T00:09:00Z'),'model');
 assert.equal(s.days['2026-10-04'].ms.model,60000);assert.equal(s.days[day].ms.unknown,300000);
});
test('partial trailing JSON is deferred and incremental replay does not double count',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ops-analytics-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'log');const s=agent('claude');
 const line=JSON.stringify({timestamp:stamp(1),type:'assistant',message:{id:'m',usage:{input_tokens:12,output_tokens:4}}});
 await fs.writeFile(file,line.slice(0,30));await updateFile(file,s);assert.equal(s.offset,0);
 await fs.appendFile(file,line.slice(30)+'\n');await updateFile(file,s);await updateFile(file,s);assert.equal(s.days[day].tokens.input,12);assert.equal(s.days[day].requests,1);
});
test('rates price cache separately and unknown models remain unknown',()=>{
 const tokens={input:1000000,read:1000000,write:0,writeHour:0,output:1000000};assert.equal(cost(tokens,'gpt-6-astra',1000,null),61);assert.equal(cost(tokens,'gpt-6-astra',300000,null),97);assert.equal(cost(tokens,'unknown',0,null),null);
});
test('asynchronous commit receipts are recovered from nested tool output',()=>{
 const s=agent('codex');ingest(s,{timestamp:stamp(1),type:'response_item',payload:{type:'function_call_output',call_id:'poll',output:JSON.stringify({output:'[main abc1234] Fix a bug\n 1 file changed\n'})}});assert.deepEqual(s.days[day].commitClaims,['abc1234']);
});
