'use strict';
// Bounded snapshot summary: task state is not proof that a process is running.
function statusText(snapshot,{ascii=false}={}){
 const tasks=snapshot.tasks||[],candidates=snapshot.candidates||[];
 const active=tasks.filter(t=>t.status==='active'),ready=tasks.filter(t=>t.status==='ready');
 const blocked=tasks.filter(t=>t.status==='blocked');
 const approvals=(snapshot.approvals?.items||[]).filter(p=>!p.sent).length;
 const short=s=>String(s||'').replace(/\s+/g,' ').trim().slice(0,76);
 const timestamp=snapshot.generatedAt||snapshot.projectStatus?.updatedAt;
 const date=new Date(timestamp),updated=Number.isNaN(date.getTime())?'unknown':date.toISOString().replace('T',' ').slice(0,16)+' UTC';
 const lines=[
  'TASK STATUS',
  `ACTIVE  ${active.length}   READY ${ready.length}   BLOCKED ${blocked.length}`,
  ...active.slice(0,2).map(t=>'NOW     '+short(t.title)),
  ...(ready.length?['NEXT    '+short(ready[0].title)]:[]),
  `CORPUS  ${candidates.length} entries`,
  `IMAGES  ${candidates.filter(c=>c.latestRun?.screenshots?.length).length} entries with latest-run images`,
  `APPROVE ${approvals} pending`,
  `CHECKED ${updated}`,
 ];
 if(!ascii)return lines.join('\n');
 const width=46,border='+'+'-'.repeat(width+2)+'+';
 const rows=[];
 for(const line of lines){let rest=line;while(rest.length>width){let cut=rest.lastIndexOf(' ',width);if(cut<8)cut=width;rows.push(rest.slice(0,cut));rest='  '+rest.slice(cut).trim();}rows.push(rest);}
 return [border,...rows.map(s=>'| '+s.padEnd(width)+' |'),border].join('\n');
}
module.exports={statusText};
