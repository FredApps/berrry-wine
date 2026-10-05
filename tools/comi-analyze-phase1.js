'use strict';
const fs = require('node:fs');
const path = require('node:path');
const directory = process.argv[2];
if (!directory) throw Error('Usage: node tools/comi-analyze-phase1.js ATTEMPT_DIRECTORY');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
const s = read('slices.json'), saved = read('observer.json'), a = saved.audio || saved;
const requests = new Map(s.rows.filter(r => r.kind === 'request').map(r => [r.id, r]));
const settled = s.rows.filter(r => r.kind === 'settled' && requests.has(r.id));
const yields = {}, gaps = [], bursts = [];
let burst = null;
for (let i = 0; i < settled.length; i++) {
  const r = settled[i], request = requests.get(r.id);
  yields[r.data.yield] = (yields[r.data.yield] || 0) + 1;
  if (i && r.id === settled[i-1].id + 1) gaps.push(request.at - settled[i-1].at);
  if (r.data.yield !== 14) {
    if (!burst) { burst = { start: request.at, end: r.at, slices: 0 }; bursts.push(burst); }
    burst.end = r.at; burst.slices++;
  } else burst = null;
}
const writes = a.events.filter(r => r.name === 'audio.writeStream');
const first = writes[0], last = writes.at(-1), f = first.voices[0], l = last.voices[0];
const summary = {
  slices: { paired: settled.length, cap: s.reason,
    coveredMs: settled.at(-1).at - requests.get(settled[0].id).at,
    yields, workerReportedWallMs: settled.reduce((sum,r) => sum+r.data.ms,0),
    pageBetweenRequestsMs: gaps.reduce((sum,v) => sum+v,0), maxPageGapMs: Math.max(...gaps),
    busyBursts: bursts, observerOverheadMs: s.overheadMs, errors: s.errors },
  audio: { windowMs: a.endMs-a.startMs, writes: writes.length,
    firstToLastWriteMs: last.atMs-first.atMs, bytesDelta: l.bytesWritten-f.bytesWritten,
    pcmSecondsDelta: (l.bytesWritten-f.bytesWritten)/(f.rate*f.channels*f.bits/8),
    audioClockDelta: l.audioTime-f.audioTime, rebaseSeconds: l.streamStartTime-f.streamStartTime,
    callbackTypes: [...new Set(a.events.map(r=>r.callback.type))],
    threads: [...new Set(a.events.map(r=>r.threadId))], overheadMs: a.overheadMs,
    maxPollGapMs:a.maxPollGapMs, errors:a.errors },
  limitations: 'Partial capped slice interval; Worker ms is wall not CPU. Audio and slice coverage differ. No owning clock-poll caller captured. No FPS or fix claim.'
};
fs.writeFileSync(path.join(directory, 'phase1-analysis.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
