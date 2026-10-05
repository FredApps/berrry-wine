'use strict';
const {chatReady,chatSubmitKey}=require('./telegram-guard');
const {parseApproval}=require('./approval-prompt');
function workReady(screen,provider) {
  if(parseApproval(screen)||/esc to (?:interrupt|cancel)|tab to queue|Would you like to|Press enter to confirm/i.test(screen.slice(-5000)))return false;
  const prompts=screen.split('\n').filter(l=>/^\s*[›❯]/.test(l));
  const lastMessage=prompts.filter(l=>!/^\s*[›❯]\s*(?:Ask Codex to do anything)?\s*$/.test(l)).at(-1)||'';
  if(/^\s*[›❯]\s*(?:\[Telegram\]\s*)?(?:stop|pause|wait|hold off|do not continue|don't continue)\b/i.test(lastMessage))return false;
  if(provider==='codex')return chatReady(screen);
  if(provider!=='claude')return false;
  const lines=screen.trimEnd().split('\n'),i=lines.findLastIndex(l=>/^\s*❯/.test(l));
  return i>=0 && /^\s*❯\s*$/.test(lines[i]) && /bypass permissions|accept edits|shift.tab to cycle/i.test(lines.slice(i+1).join('\n'));
}
function workSubmitKey(screen,message,provider) {
  if(provider==='codex')return chatSubmitKey(screen,message);
  if(provider!=='claude'||parseApproval(screen)||/esc to interrupt|Would you like to|Press enter to confirm/i.test(screen.slice(-5000)))return null;
  const lines=screen.trimEnd().split('\n'),i=lines.findLastIndex(l=>/^\s*❯/.test(l));
  if(i<0)return null;
  const draft=[];
  for(let n=i;n<lines.length;n++){const l=lines[n].replace(n===i?/^\s*❯\s?/:/^/,'');if(!l.trim()||/^[─━]+/.test(l))break;draft.push(l);}
  return draft.join('').replace(/\s/g,'')===message.replace(/\s/g,'')?'Enter':null;
}
module.exports={workReady,workSubmitKey};
