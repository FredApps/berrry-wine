// Appended only to the benchmark's served guest-worker.js. Run between slices
// on slot zero: histogram memory is shared, but its enable flag is per instance.
globalThis.__nfsGuestProfile = action => {
  if (globalThis.__nfsProfileSlot !== 0 || !instance) return null;
  const e = instance.exports;
  const counters = () => ({
    runtime: Array.from({length:21}, (_,i) => e.uop_stats(i) >>> 0),
    compiler: Array.from({length:31}, (_,i) => e.uop_cstat(i) >>> 0),
    declines: Array.from({length:28}, (_,i) => e.uop_decline_count(i) >>> 0),
  });
  if (action === 'arm') {
    e.reset_handler_hist();
    e.set_handler_hist_enabled(1);
    return {at:performance.now(), uop:counters()};
  }
  if (action !== 'read') return {slot:0};
  e.set_handler_hist_enabled(0);
  const m = new Uint32Array(memory.buffer), handlers = [], blocks = [];
  let ops = 0, blockHits = 0;
  const hb = e.get_handler_hist_base() >>> 2, bb = e.get_hot_block_hist_base() >>> 2;
  for (let i=0;i<e.get_handler_hist_slots();i++) {
    const count=m[hb+i]; if(count){handlers.push([i,count]);ops+=count;}
  }
  for (let i=0;i<e.get_hot_block_hist_count();i++) {
    const address=m[bb+i*2], count=m[bb+i*2+1];
    if(address&&count){blocks.push([address.toString(16),count]);blockHits+=count;}
  }
  handlers.sort((a,b)=>b[1]-a[1]);blocks.sort((a,b)=>b[1]-a[1]);
  const censusEnd=globalThis.__nfsUopRecords.length;
  e.uop_census_dump();
  const census=globalThis.__nfsUopRecords.slice();
  // Dump rows are snapshots, not events to replay again in the next window.
  globalThis.__nfsUopRecords.length=censusEnd;
  return {at:performance.now(), ops,handlers,blockHits,blocks,distinct:blocks.length,
    collisions:e.get_hot_block_hist_collisions()>>>0,uop:counters(),census,
    censusTruncated:globalThis.__nfsUopTruncated||false};
};
