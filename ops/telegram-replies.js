'use strict';
const {createHash}=require('node:crypto');
function reply(record){
 const p=record.payload;
 if(record.type!=='response_item'||p?.type!=='message'||p.role!=='assistant'||!['commentary','final','final_answer',undefined].includes(p.phase))return null;
 const text=p.content?.filter(c=>c.type==='output_text').map(c=>c.text).join('\n');
 if(!text)return null;
 return {id:p.id||createHash('sha256').update(JSON.stringify(record)).digest('hex'),text,phase:p.phase,at:record.timestamp};
}
// Claude Code transcript lines → the Codex rollout shape the rest of this file reads.
// Claude records carry no turn id, so turns fall back to telegramActiveTurn; a text
// block is final only when its message stopped with end_turn.
function fromClaude(record){
 if(!['user','assistant'].includes(record?.type)||record.isSidechain||record.isMeta||!record.message)return record;
 const m=record.message,content=typeof m.content==='string'?[{type:'text',text:m.content}]:Array.isArray(m.content)?m.content:[];
 if(record.type==='user'){
  if(content.some(c=>c.type==='tool_result'))return null;
  const text=content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  return text?{type:'response_item',timestamp:record.timestamp,payload:{type:'message',role:'user',content:[{type:'input_text',text}]}}:null;
 }
 const text=content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
 if(!text)return null;
 return {type:'response_item',timestamp:record.timestamp,payload:{type:'message',role:'assistant',id:record.uuid,phase:m.stop_reason==='end_turn'?'final':'commentary',content:[{type:'output_text',text}]}};
}
function enqueue(state,record){
 record=fromClaude(record);if(!record)return;
 const p=record.payload,turn=p?.internal_chat_message_metadata_passthrough?.turn_id;
 if(record.type==='response_item'&&p?.type==='message'&&p.role==='user'){
  const fromTelegram=p.content?.some(c=>c.type==='input_text'&&c.text.startsWith('[Telegram] '));
  state.telegramActiveTurn=!!fromTelegram;
  if(fromTelegram&&turn)state.telegramTurns=[...new Set([...(state.telegramTurns||[]),turn])].slice(-100);
  return;
 }
 const item=reply(record);if(!item)return;
 if(item.phase==='commentary')return;
 const direct=turn?(state.telegramTurns||[]).includes(turn):state.telegramActiveTurn;
 const milestone=item.text.startsWith('[Telegram update] ');
 if(!direct&&!milestone)return;
 if(milestone)item.text=item.text.slice('[Telegram update] '.length);
 item.text=item.text.replace(/^(?:\s*Orchestrator\s*\r?\n)+/i,'');
 item.direct=!!direct;
 state.replyQueue??=[];state.replySeen??=[];
 if(state.replySeen.includes(item.id)||state.replyQueue.some(x=>x.id===item.id))return;
 const chunks=formatChunks(item.text);
 state.replyQueue.push({...item,chunks,next:0});
}
async function flush(state,save,send,now=Date.now){
 for(let count=0;state.replyQueue?.length&&count<10;count++){
  const item=state.replyQueue[0];
  if(item.retryAt>now())return;
  try{
   const chunk=item.chunks[item.next];
   const result=typeof chunk==='string'?await send(chunk):await send(chunk.text,{entities:chunk.entities});
   item.next++;state.lastReplyDelivery={id:item.id,messageId:result?.message_id,at:now()};
   if(item.next===item.chunks.length){if(item.direct)state.lastDirectReplyAt=now();state.replyQueue.shift();state.replySeen.push(item.id);state.replySeen=state.replySeen.slice(-1000);}
   await save();
  }catch(e){item.retryAt=now()+10000;state.replyError={at:now(),message:e.message};await save();return;}
 }
}
function formatChunks(text){
 const chunks=[];let current={text:'',entities:[]},code=false;
 const add=(value)=>{while(value){let take=Math.min(3000-current.text.length,value.length);if(take&&/[\uD800-\uDBFF]/.test(value[take-1]))take--;
  if(!take){chunks.push(current);current={text:'',entities:[]};continue;}
  const offset=current.text.length;current.text+=value.slice(0,take);if(code)current.entities.push({type:'pre',offset,length:take});value=value.slice(take);
  if(current.text.length>=3000){chunks.push(current);current={text:'',entities:[]};}
 }};
 const fence=/^```[^\n]*\n?|^```\s*$/gm;let start=0,m;
 while((m=fence.exec(text))){add(text.slice(start,m.index));code=!code;start=fence.lastIndex;}
 add(text.slice(start));if(current.text)chunks.push(current);return chunks;
}
module.exports={reply,enqueue,flush,formatChunks,fromClaude};
