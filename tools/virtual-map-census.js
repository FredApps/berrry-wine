#!/usr/bin/env node
'use strict';
// Read the `virtual_maps:` table run.js prints at exit and answer the one
// question a raw dump cannot: is the sparse backing window full because the
// guest genuinely holds that much memory, or because the live extents are
// scattered and the holes between them are unusable?
//
// Usage: node tools/virtual-map-census.js <run.log> [--holes=N] [--json]
//
// Prints total live bytes, the high-water mark, every hole in the backing pool
// ranked by size, and the largest allocation the pool could still satisfy --
// contiguously, and with the split fallback that may use several holes.
const fs=require('fs');

function parse(text){
  const header=text.match(/virtual_maps: count=(\d+) backing_top=0x([0-9a-f]+) reservation_top=0x([0-9a-f]+)/);
  const records=[];
  const line=/^\s*\[(\d+)\] guest=0x([0-9a-f]+)\.\.0x([0-9a-f]+) size=0x([0-9a-f]+) backing=0x([0-9a-f]+)/gm;
  for(let m;(m=line.exec(text));)records.push({
    index:+m[1],guest:parseInt(m[2],16),guestEnd:parseInt(m[3],16),
    size:parseInt(m[4],16),backing:parseInt(m[5],16),
  });
  return {
    count:header?+header[1]:records.length,
    backingTop:header?parseInt(header[2],16):null,
    reservationTop:header?parseInt(header[3],16):null,
    records,
  };
}

function census(dump,{base=null,end=null}={}){
  const {records}=dump;
  if(!records.length)throw new Error('no virtual map records in that log');
  const live=records.map(r=>({start:r.backing,end:r.backing+r.size})).sort((a,b)=>a.start-b.start);
  const poolBase=base??live[0].start;
  const poolEnd=end??dump.backingTop??live[live.length-1].end;
  const holes=[];
  let cursor=poolBase,liveBytes=0,overlap=0;
  for(const extent of live){
    if(extent.start>cursor)holes.push({start:cursor,size:extent.start-cursor});
    else if(extent.start<cursor)overlap+=cursor-extent.start;
    liveBytes+=Math.min(extent.end,poolEnd)-Math.max(extent.start,cursor,poolBase);
    cursor=Math.max(cursor,extent.end);
  }
  if(poolEnd>cursor)holes.push({start:cursor,size:poolEnd-cursor,tail:true});
  holes.sort((a,b)=>b.size-a.size);
  const freeBytes=holes.reduce((n,h)=>n+h.size,0);
  // Duplicate guest ranges are the split fallback's continuations: one commit
  // that could not find a single hole big enough and took several.
  const byGuest=new Map();
  for(const r of records)byGuest.set(r.guest,(byGuest.get(r.guest)||0)+1);
  const split=[...byGuest].filter(([,n])=>n>1);
  return {poolBase,poolEnd,span:poolEnd-poolBase,liveBytes,freeBytes,overlap,holes,
    largestHole:holes.length?holes[0].size:0,splitCommits:split.length,records:records.length};
}

const mb=n=>(n/1048576).toFixed(1)+' MB';

if(require.main===module){
  const args=process.argv.slice(2),file=args.find(a=>!a.startsWith('--'));
  if(!file){console.error('usage: virtual-map-census.js <run.log> [--holes=N] [--json]');process.exit(2);}
  const limit=Number((args.find(a=>a.startsWith('--holes='))||'--holes=10').slice(8));
  const dump=parse(fs.readFileSync(file,'utf8'));
  const c=census(dump);
  if(args.includes('--json')){console.log(JSON.stringify({...dump,records:dump.records.length,census:c},null,2));return;}
  console.log(`${file}`);
  console.log(`  records ${c.records}   pool 0x${c.poolBase.toString(16)}..0x${c.poolEnd.toString(16)} (${mb(c.span)})`);
  console.log(`  live ${mb(c.liveBytes)} (${(100*c.liveBytes/c.span).toFixed(1)}%)   free in holes ${mb(c.freeBytes)}   largest hole ${mb(c.largestHole)}`);
  if(c.overlap)console.log(`  OVERLAPPING backing extents: ${mb(c.overlap)} -- two guest ranges share bytes`);
  console.log(`  split commits (one guest range over several holes): ${c.splitCommits}`);
  console.log(`  holes, largest first:`);
  for(const h of c.holes.slice(0,limit))
    console.log(`    0x${h.start.toString(16)} ${mb(h.size).padStart(9)}${h.tail?'  (tail, below the high-water mark only if the pool end is known)':''}`);
  if(c.holes.length>limit)console.log(`    ... ${c.holes.length-limit} more`);
}

module.exports={parse,census};
