'use strict';

// A deliberately narrow adapter for the observed Codex command-approval UI.
// Terminal text is an observation, not a structured/authenticated Codex event.
function parseApproval(screen) {
  if (typeof screen !== 'string' || screen.length > 131072) return null;
  const lines=screen.trimEnd().split('\n').map(line=>line.trim());
  const start=lines.lastIndexOf('Would you like to run the following command?');
  if(start<0 || !/^Press enter to confirm or esc to cancel(?: or o to open thread)?$/.test(lines.at(-1)))return null;
  const prompt=lines.slice(start).join('\n');
  if(!/^[›>]?\s*1\. Yes, proceed \(y\)$/m.test(prompt) || !/^[›>]?\s*\d\. No, and tell Codex what to do differently \(esc\)$/m.test(prompt))return null;
  const commandStart=lines.findIndex((line,i)=>i>start && line.startsWith('$ '));
  const menu=lines.findIndex((line,i)=>i>commandStart && /^[›>]?\s*1\. Yes, proceed \(y\)$/.test(line));
  if(commandStart<0 || menu<0)return null;
  const command=lines.slice(commandStart,menu).join('\n').trim().slice(2);
  if(!command)return null;
  const field=name=>lines.slice(start,commandStart).find(line=>line.startsWith(name+':'))?.slice(name.length+1).trim() || '';
  return {command,reason:field('Reason'),thread:field('Thread'),environment:field('Environment'),prompt};
}
module.exports={parseApproval};
