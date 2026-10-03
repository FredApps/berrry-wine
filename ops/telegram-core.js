'use strict';
const crypto=require('node:crypto');
const {approvalIdentity}=require('./approval-prompt');
const formatting=require('./telegram-format');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const promptHash=p=>hash(p.terminalId+'\n'+approvalIdentity(p.prompt));
const isStatusQuestion=text=>/^(?:\/status|status|(?:ascii(?: art)? )?tldr(?: status)?|(?:what['’]?s|whats['’]?|whtas['’]?) (?:the )?latest|any updates?|sup|hi|hey)[?!.]*$/i.test(text.trim());
const HELP='Send text to chat with the orchestrator.\n/status — task summary\n/screen — current terminal\n/approvals — pending command\n/queue — waiting messages\n/cancel — cancel waiting messages\n/help — this help\n\nApproval buttons accept once, decline, or allow the displayed persistent rule when supported. Plain chat never answers a permission prompt. Direct answers and explicit milestones are forwarded; routine progress stays on the dashboard.';
function createBot({state,save,telegram,local,now=Date.now}) {
  let typingBusy=false,lastTyping=0;
  async function typing(){
    if(typingBusy||!state.owner||!state.lastChat||state.pending||now()-state.lastChat.at>10*60000||state.lastDirectReplyAt>=state.lastChat.at||now()-lastTyping<3500)return;
    typingBusy=true;lastTyping=now();
    try{await telegram('sendChatAction',{chat_id:state.owner.chatId,action:'typing'});}catch{}finally{typingBusy=false;}
  }
  const send=async(text,extra={})=>{
    const chunks=String(text).match(/[\s\S]{1,3500}/g)||['(empty)'];
    let result;for(let i=0;i<chunks.length;i++)result=await telegram('sendMessage',{chat_id:state.owner.chatId,text:chunks[i],...(i===chunks.length-1?extra:{})});return result;
  };
  const authorized=(user,chat)=>!!state.owner && chat?.type==='private' && user?.id===state.owner.userId && chat.id===state.owner.chatId;
  async function sendStatus(){
    const s=await local('/api/state');
    const summary=s.projectStatus;
    const rows=s.tasks.filter(t=>['active','ready','blocked','review'].includes(t.status));
    const body=summary?.available&&summary.body
      ? summary.body+'\n\nSummary updated: '+(summary.updatedAt||'unknown')
      : rows.slice(0,8).map(t=>`${t.status.toUpperCase()}: ${t.title}`).join('\n')||'No current task status recorded.';
    const result=await send('Dashboard status\n'+body+'\n\nPending approvals: '+(s.approvals?.items.filter(p=>!p.sent).length||0));
    state.lastStatusDelivery={at:now(),messageId:result?.message_id};await save();return result;
  }
  async function notifyApproval(p) {
    const key=promptHash(p);
    if(!state.owner || p.sent || p.terminalId!=='orchestrator')return;
    const parts=formatting.approval(p);
    if(state.notified===key){
      if(state.pending?.messageId&&state.pending.formatVersion!==1&&parts.length===1){
        await telegram('editMessageText',{chat_id:state.owner.chatId,message_id:state.pending.messageId,text:parts[0].text,entities:parts[0].entities,reply_markup:{inline_keyboard:[[{text:'Accept once',callback_data:'a:'+state.pending.id}],...(p.allowRule?[[{text:'Always allow shown rule',callback_data:'p:'+state.pending.id}]]:[]),[{text:'Decline',callback_data:'d:'+state.pending.id}]]}});
        state.pending.formatVersion=1;await save();
      }
      return;
    }
    if(state.pending?.messageId)await telegram('editMessageReplyMarkup',{chat_id:state.owner.chatId,message_id:state.pending.messageId,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
    state.pending={id:p.id,hash:key,formatVersion:1};await save();
    const buttons=[{text:'Accept once',callback_data:'a:'+p.id}];
    if(p.allowRule)buttons.push({text:'Always allow shown rule',callback_data:'p:'+p.id});
    buttons.push({text:'Decline',callback_data:'d:'+p.id});
    let message;
    for(let i=0;i<parts.length;i++)message=await send(parts[i].text,{entities:parts[i].entities,...(i===parts.length-1?{reply_markup:{inline_keyboard:buttons.map(b=>[b])}}:{})});
    state.pending.messageId=message.message_id;state.notified=key;await save();
  }
  async function handle(update) {
    const callback=update.callback_query,m=update.message;
    if(callback){
      if(!authorized(callback.from,callback.message?.chat))return;
      await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'Checking current prompt…'});
      const match=/^([adp]):([a-f0-9]{48})$/.exec(callback.data||''),pending=state.pending;
      const snapshot=await local('/api/state');
      const refresh=async()=>{
        await telegram('editMessageReplyMarkup',{chat_id:state.owner.chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
        const current=snapshot.approvals?.items.find(p=>!p.sent&&p.terminalId==='orchestrator');
        if(current)await notifyApproval(current);
        if(state.staleNotice!==callback.message.message_id){state.staleNotice=callback.message.message_id;await save();await send(current?'That button is no longer current. Review the current approval above.':'That request is already closed.');}
      };
      if(!match || !pending || pending.id!==match[2] || pending.messageId!==callback.message.message_id)return refresh();
      const live=snapshot.approvals?.items.find(p=>!p.sent && p.terminalId==='orchestrator' && promptHash(p)===pending.hash);
      if(!live || (match[1]==='p'&&!live.allowRule)){state.pending=null;state.notified=null;await save();return refresh();}
      state.pending=null;await save(); // Consume before delivery: never replay an ambiguous approval.
      try{await local('/api/approval-decision',{id:live.id,decision:match[1]==='a'?'accept':match[1]==='p'?'allow-rule':'decline'});await send(match[1]==='a'?'Accepted once.':match[1]==='p'?'Approved the persistent rule shown in the prompt.':'Declined.');}
      catch(e){await send(e.message+' No automatic retry. Use /screen to inspect.');}
      await telegram('editMessageReplyMarkup',{chat_id:state.owner.chatId,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
      return;
    }
    if(!m || m.chat?.type!=='private' || m.from?.is_bot || typeof m.text!=='string')return;
    if(!state.owner){
      const code=/^\/start ([a-f0-9]{32})$/.exec(m.text);
      if(!code || !state.pairing || state.pairing.expires<now() || hash(code[1])!==state.pairing.hash){
        return telegram('sendMessage',{chat_id:m.chat.id,text:'Hi! This bot is not paired yet. Open the private pairing link from your dashboard setup conversation and tap Start, or paste its /start code here. If the link expired, ask for a new one. No orchestrator access is enabled until pairing succeeds.'});
      }
      state.owner={userId:m.from.id,chatId:m.chat.id};delete state.pairing;state.pairedAt=now();await save();
      return send('Hi! I’m connected to the Wine Assembly orchestrator. This private account is now paired. Send me a message and I’ll pass it on.\n\n'+HELP);
    }
    if(!authorized(m.from,m.chat))return;
    if(m.date && now()-m.date*1000>5*60000)return send('Old message ignored. Please resend it if still needed.');
    const text=m.text.trim();
    if(['/help','/start'].includes(text))return send(HELP);
    if(text==='/queue')return send(state.chatQueue?.length?state.chatQueue.map((x,i)=>`${i+1}. ${x.text}`).join('\n'):'No messages waiting.');
    if(text==='/cancel'){state.chatQueue=[];await save();return send('Waiting messages cancelled.');}
    if(text==='/screen'){const s=await local('/api/orchestrator-screen');for(const part of formatting.chunks([{text:s.text,type:'pre'}]))await send(part.text,{entities:part.entities});return;}
    if(isStatusQuestion(text))return sendStatus();
    if(text==='/approvals'){const s=await local('/api/state');const p=s.approvals?.items.find(p=>p.terminalId==='orchestrator'&&!p.sent);if(!p)return send('No supported live command-approval prompt. /screen shows other prompts.');state.notified=null;return notifyApproval(p);}
    if(text.startsWith('/'))return send(HELP);
    if(text.length>4000)return send('Please keep messages under 4,000 characters.');
    state.chatQueue??=[];
    if(state.chatQueue.length>=20)return send('20 messages are waiting. Use /queue or /cancel first.');
    state.chatQueue.push({text,at:now(),messageId:m.message_id});await save();
    state.lastChat={text,at:now()};await save();await typing();
    await drainChat();
  }
  async function drainChat(){
    if(state.chatAttempt){state.chatAttempt=null;await save();await send('A previous message delivery could not be confirmed after restart. Check /screen before resending.');}
    const item=state.chatQueue?.[0];if(!item)return;
    if(now()-item.at>60*60*1000){state.chatQueue.shift();await save();await send('A waiting message reached its one-hour limit and was not sent: '+item.text);return 'expired';}
    // Persist the attempt before input. Only explicit pre-input rejection permits retry.
    state.chatQueue.shift();state.chatAttempt=item;await save();
    let failure;try{await local('/api/orchestrator-chat',{message:item.text});}catch(e){failure=e;}
    state.chatAttempt=null;
    if(failure){
      if(failure.status===409 && /^(Orchestrator has a prompt or draft open\.|Terminal is being controlled;)/.test(failure.message)){
        state.chatQueue.unshift(item);await save();return 'waiting';
      }
      await save();await send('Could not confirm delivery. Check /screen before resending. Your other waiting messages remain saved.');return 'uncertain';
    }
    state.lastChat={text:item.text,at:now()};await save();await typing();return 'sent';
  }
  return {handle,notifyApproval,send,sendStatus,drainChat,typing};
}
module.exports={createBot,hash};
