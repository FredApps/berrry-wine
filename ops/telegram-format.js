'use strict';
// Telegram entity offsets are UTF-16, matching JavaScript string offsets.
function chunks(segments){
 const result=[];let current={text:'',entities:[]};
 for(const segment of segments){let text=segment.text;
  while(text){let size=Math.min(3000-current.text.length,text.length);
   if(size&&/[\uD800-\uDBFF]/.test(text[size-1]))size--;
   if(!size){result.push(current);current={text:'',entities:[]};continue;}
   const offset=current.text.length;current.text+=text.slice(0,size);
   if(segment.type)current.entities.push({type:segment.type,offset,length:size});
   text=text.slice(size);
   if(current.text.length===3000){result.push(current);current={text:'',entities:[]};}
  }
 }
 if(current.text)result.push(current);return result;
}
function approval(p){
 const segments=[{text:'Approval needed',type:'bold'}];
 if(p.reason)segments.push({text:'\n\n'+p.reason});
 if(p.thread||p.environment)segments.push({text:'\n\n'+[p.thread,p.environment].filter(Boolean).join(' · ')});
 segments.push({text:'\n\nCommand\n'},{text:p.command||p.prompt,type:'pre'});
 if(p.allowRule){
  const rule=p.prompt.match(/^[›>]?\s*2\. (Yes, and don't ask again for commands that start with[\s\S]*?) \(p\)\s*$/m)?.[1];
  segments.push({text:'\n\nPersistent permission\n'},{text:rule||p.prompt,type:'pre'});
 }
 return chunks(segments);
}
module.exports={chunks,approval};
