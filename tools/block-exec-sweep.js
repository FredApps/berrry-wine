#!/usr/bin/env node
// Does `--block-exec` still show the same screen, for every app in the
// registry?
//
// This is the gate for ever turning the block executor on by default. The
// per-window counter tables in docs/block-executor-design.md say what the
// executor *does*; they say nothing about whether the 209 ids in lib/apps.js
// still draw what they drew. A hand-run A/B on three games is not that answer,
// and "it passed on quake2, heroes2 and rct" is exactly the evidence that
// hides a one-app miscompile.
//
// The shape is the two-budget rule from docs/block-executor-design.md section
// 14, applied registry-wide and with its control included:
//
//   * every app is photographed FOUR times -- {executor off, executor on} x
//     {budget 1, budget 2} -- and the off arm's own budget-to-budget diff is
//     kept as the null band. One budget cannot tell a rendering difference
//     from a frame caught at a different point of a clock-paced animation, and
//     without the off-vs-off control there is no scale to judge an on-vs-off
//     difference against: quake2 moves 73% of its own frame between two
//     budgets with no executor in the picture at all.
//   * the classification is therefore RELATIVE. Arms that differ by less than
//     the off arm differs from itself, and that converge as the budget grows,
//     are PACING. Anything else is DIFFERENT and wants a human.
//
// Every DIFFERENT and every CRASH row carries the exact command line that
// reproduces it, because a sweep result nobody can re-run is a rumour.
//
// Usage:
//   node tools/block-exec-sweep.js --all --no-build [--jobs=4]
//   node tools/block-exec-sweep.js --apps=rct,heroes2_demo --shots=DIR
//   node tools/block-exec-sweep.js --all --json=out.json --md=out.md --sheet=sheet.png
//
// Options:
//   --apps=a,b,c    only these ids (default: every id in lib/apps.js)
//   --all           explicit "the whole registry" (the default)
//   --skip=a,b      additional ids to leave out, on top of SKIP_DEFAULT
//   --no-skip       do not apply SKIP_DEFAULT (measure the non-starters too)
//   --budgets=A,B   the two --max-batches budgets (default 300,600)
//   --batch-size=N  --batch-size for every run (default 20000). A budget is a
//                   count of BLOCKS, not of work, so this is the knob that
//                   decides whether 300 batches is a splash screen or a menu.
//   --seconds=N     run.js --max-seconds per run (default 150)
//   --timeout=N     outer `timeout` per run, seconds (default 180)
//   --jobs=N        apps in flight at once (default 4, capped at 4). The four
//                   runs of ONE app are always serial.
//   --tolerance=N   per-channel tolerance handed to tools/png-diff.js
//   --shots=DIR     where the PNGs and logs go (default a temp dir)
//   --json=FILE     machine-readable result
//   --md=FILE       the markdown table
//   --sheet=FILE    contact sheet of the DIFFERENT and CRASH captures
//   --control       add a FIFTH run per app: the off arm at the larger budget,
//                   a second time. Two runs of one arm must be byte-identical;
//                   if they are not, the app is nondeterministic and no
//                   on-vs-off number from it means anything. Opt-in because it
//                   is a 25% longer sweep, and worth it on a re-run of just the
//                   DIFFERENT rows.
//   --no-build      reuse build/wine-assembly.wasm (you want this)
//
// Classes:
//   IDENTICAL  on == off at both budgets, pixel for pixel
//   PACING     they differ, but by less than the off arm differs from itself
//              across the two budgets, and the difference converges
//   DIFFERENT  anything else that produced pictures -- needs a look
//   CRASH      an arm hit an unimplemented API or a WASM trap
//   TIMEOUT    an arm did not come back inside --timeout
//   NOPIC      no arm ever painted (the app does not start headless); not a
//              verdict about the executor, and reported separately
//   NONDET     --control only: the off arm disagreed with ITSELF at one budget,
//              so nothing else measured on this app is evidence
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'test', 'run.js');
const { APPS } = require('../lib/apps');
const { diffPng } = require('./png-diff');

// Documented non-starters, and why each is not a question about the executor.
// --no-skip measures them anyway.
const SKIP_DEFAULT = {
  // A LAN app with no peer sits in a connect loop; the picture is a dialog,
  // and which batch the socket gives up on is a timing coin flip, not a
  // rendering difference. See docs/re-notes and project_hearts_vlan.
  mshearts16: 'LAN app, needs a peer process',
  liquid_war: 'LAN app, needs a peer process',
  liquid_war_server: 'LAN app, needs a peer process',
  tetrinet: 'LAN app, needs a peer process',
  ut2003_demo_server: 'listen server, needs a peer process',
  // msvbvm60.dll is absent from every local medium (the Win98 SE CD ships
  // msvbvm50). Both arms fail identically at import resolution.
  jigssawme: 'imports MSVBVM60.DLL, which no local medium has',
  rodent2000: 'imports MSVBVM60.DLL, which no local medium has',
  // Explorer 98 needs the 16-bit SHELL.DLL behind a QT_Thunk block.
  explorer98: 'SHELL32 QT_Thunk path, no NE thunk binding',
};

const argv = process.argv.slice(2);
const flag = name => argv.includes('--' + name);
const opt = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const list = name => (opt(name, '') || '').split(',').map(s => s.trim()).filter(Boolean);

const BUDGETS = (opt('budgets', '300,600') || '').split(',')
  .map(s => parseInt(s, 10)).filter(n => n > 0);
if (BUDGETS.length !== 2) {
  console.error('--budgets wants exactly two batch counts, e.g. --budgets=300,600');
  process.exit(2);
}
const BATCH_SIZE = parseInt(opt('batch-size', '20000'), 10) || 20000;
const SECONDS = parseInt(opt('seconds', '150'), 10) || 150;
const TIMEOUT = parseInt(opt('timeout', '180'), 10) || 180;
const JOBS = Math.max(1, Math.min(4, parseInt(opt('jobs', '4'), 10) || 4));
const TOLERANCE = parseInt(opt('tolerance', '0'), 10) || 0;
const SHOTS = opt('shots', path.join(os.tmpdir(), 'block-exec-sweep'));
const JSON_OUT = opt('json', null);
const MD_OUT = opt('md', null);
const SHEET_OUT = opt('sheet', null);
const CONTROL = flag('control');
const NO_BUILD = flag('no-build');
const VERBOSE = flag('verbose');

const skipExtra = new Set(list('skip'));
let ids = list('apps');
if (!ids.length) ids = Object.keys(APPS);
for (const id of ids) {
  if (!APPS[id]) { console.error(`unknown app id: ${id}`); process.exit(2); }
}
const skipped = [];
ids = ids.filter((id) => {
  const why = skipExtra.has(id) ? 'named in --skip'
    : (!flag('no-skip') && SKIP_DEFAULT[id]) || null;
  if (why) { skipped.push({ id, why }); return false; }
  return true;
});

fs.mkdirSync(SHOTS, { recursive: true });

// One run's argv, as run.js sees it. Kept as an array so the command line
// printed in the report is the one that actually ran -- a repro line rebuilt
// by hand from prose is how an unreproducible row gets into a table.
function runArgs(id, arm, budget, png) {
  const args = [
    'test/run.js', `--app=${id}`,
    `--batch-size=${BATCH_SIZE}`,
    `--max-batches=${budget}`,
    `--max-seconds=${SECONDS}`,
    // The stuck detector ends an idle run early, and an app parked on a modal
    // or a blocking API is idle by its measure; that would cut one arm's run
    // short and photograph two different moments for reasons unrelated to the
    // executor. See feedback_stuck_detector_ends_idle_runs.
    '--stuck-after=1000000',
    '--quiet-api', '--quiet-blocks', '--no-close',
    '--block-exec-stats',
    `--png=${png}`,
  ];
  if (NO_BUILD) args.push('--no-build');
  if (arm === 'on') args.push('--block-exec');
  return args;
}

function repro(id, arm, budget, png) {
  return `timeout ${TIMEOUT} node ` + runArgs(id, arm, budget, png)
    .map(a => (/[ "'$]/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

function runOnce(id, arm, budget, label) {
  const tag = `${id}-${budget}-${label || arm}`;
  const png = path.join(SHOTS, `${tag}.png`);
  const log = path.join(SHOTS, `${tag}.log`);
  try { fs.unlinkSync(png); } catch (_) { /* first run */ }
  // Plain SIGTERM `timeout`, not `-s KILL`: run.js's own --max-seconds is the
  // real guard and stops between batches with its diagnostics intact, so this
  // is only the harness backstop for a batch that never returns.
  const args = [String(TIMEOUT), 'node', ...runArgs(id, arm, budget, png)];
  return new Promise((resolve) => {
    execFile('timeout', args, {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const out = String(stdout || '') + String(stderr || '');
      fs.writeFileSync(log, out);
      const code = err ? (err.code == null ? -1 : err.code) : 0;
      resolve({
        id, arm, budget, png, log, code,
        exists: fs.existsSync(png),
        // run.js's exit line, `Stats: N API calls, B batches in Ts`. A run that
        // stopped short of its --max-batches ran out of --max-seconds instead,
        // and then the two arms photographed different moments for a reason
        // that has nothing to do with the executor.
        reached: reachedBatches(out),
        timedOut: code === 124 || code === 137,
        crash: /UNIMPLEMENTED API|unreachable|RuntimeError|\bCRASH\b/.test(out),
        crashLine: crashLineOf(out),
        stats: statsOf(out),
        repro: repro(id, arm, budget, png),
      });
    });
  });
}

function reachedBatches(out) {
  let last = null;
  for (const m of out.matchAll(/(\d+) batches in /g)) last = m;
  return last ? Number(last[1]) : null;
}

// The first line that names the failure, so a CRASH row says what broke
// without anyone opening the log.
function crashLineOf(out) {
  for (const line of out.split('\n')) {
    if (/UNIMPLEMENTED API|unreachable|RuntimeError|\bCRASH\b/.test(line)) {
      return line.trim().slice(0, 240);
    }
  }
  return null;
}

// `block-exec: M armed yes installs N declines N entries N ops native N
// fallback N native% X ...` -- kept whole for the CRASH rows, because "the
// executor was armed and had installed nothing" and "it had installed 40000
// descriptors" are different bugs.
function statsOf(out) {
  const m = /^block-exec: .*$/m.exec(out);
  const r = /^block-exec-regions: (?!.*byN|.*discovery|.*declinedBy|.*chainEndedBy|.*classifyRefused).*$/m.exec(out);
  const installs = m ? /installs (\d+)/.exec(m[0]) : null;
  const entries = m ? /entries (\d+)/.exec(m[0]) : null;
  const nativePct = m ? /native% ([\d.-]+)/.exec(m[0]) : null;
  return {
    blockExec: m ? m[0].trim() : null,
    regions: r ? r[0].trim() : null,
    installs: installs ? parseInt(installs[1], 10) : null,
    entries: entries ? parseInt(entries[1], 10) : null,
    nativePct: nativePct ? nativePct[1] : null,
  };
}

function diffOf(a, b) {
  if (!a || !b || !fs.existsSync(a) || !fs.existsSync(b)) return null;
  const d = diffPng(a, b, { tolerance: TOLERANCE });
  if (d.sizeMismatch) return { sizeMismatch: true, share: 1, changed: -1, box: null };
  return { sizeMismatch: false, share: d.share, changed: d.changed, compared: d.compared, box: d.box };
}

async function sweepApp(id) {
  const runs = {};
  for (const budget of BUDGETS) {
    for (const arm of ['off', 'on']) {
      runs[`${arm}${budget}`] = await runOnce(id, arm, budget);
    }
  }
  const [b1, b2] = BUDGETS;
  if (CONTROL) runs.control = await runOnce(id, 'off', b2, 'off2');
  const all = Object.values(runs);

  const timeouts = all.filter(r => r.timedOut);
  const crashes = all.filter(r => r.crash);
  // on-vs-off at each budget, and the off arm against itself across budgets.
  const onOff = {
    [b1]: diffOf(runs[`off${b1}`].png, runs[`on${b1}`].png),
    [b2]: diffOf(runs[`off${b2}`].png, runs[`on${b2}`].png),
  };
  const offSelf = diffOf(runs[`off${b1}`].png, runs[`off${b2}`].png);
  const control = CONTROL ? diffOf(runs[`off${b2}`].png, runs.control.png) : null;
  // A run stopped by --max-seconds did not reach the same point as its partner.
  // On a loaded box this is the single most common way a pacing difference gets
  // dressed up as a rendering one, so it is recorded on every row.
  const short = all.filter(r => r.reached != null && r.reached < r.budget)
    .map(r => `${r.arm}@${r.budget} reached ${r.reached}`);

  let verdict;
  let note = '';
  if (crashes.length) {
    verdict = 'CRASH';
    note = `${crashes.map(r => `${r.arm}@${r.budget}`).join(' ')}`;
  } else if (timeouts.length) {
    verdict = 'TIMEOUT';
    note = `${timeouts.map(r => `${r.arm}@${r.budget}`).join(' ')}`;
  } else if (control && control.changed !== 0) {
    // Two runs of the SAME arm disagreeing means nothing downstream is
    // evidence; say so instead of reporting an on-vs-off number from it.
    verdict = 'NONDET';
    note = `off arm differs from itself at ${b2}: ${pct(control)}`;
  } else if (!all.some(r => r.exists)) {
    verdict = 'NOPIC';
    note = 'no arm painted';
  } else if (!onOff[b1] || !onOff[b2]) {
    // One budget produced a picture and the other did not -- that is itself a
    // difference in how far the arms got, and it is not a class this can
    // resolve.
    verdict = 'DIFFERENT';
    note = 'a capture is missing at one budget';
  } else if (onOff[b1].changed === 0 && onOff[b2].changed === 0) {
    verdict = 'IDENTICAL';
  } else {
    const worst = Math.max(onOff[b1].share, onOff[b2].share);
    const nullBand = offSelf && !offSelf.sizeMismatch ? offSelf.share : 0;
    const converges = onOff[b2].share <= onOff[b1].share;
    if (worst < nullBand && converges) {
      verdict = 'PACING';
      note = `worst ${(worst * 100).toFixed(3)}% < off-vs-off ${(nullBand * 100).toFixed(3)}%`;
    } else {
      verdict = 'DIFFERENT';
      note = `worst ${(worst * 100).toFixed(3)}% vs off-vs-off ${(nullBand * 100).toFixed(3)}%`
        + (converges ? '' : ', diverging');
    }
  }

  if (short.length && (verdict === 'DIFFERENT' || verdict === 'PACING')) {
    note += `${note ? '; ' : ''}time-capped: ${short.join(', ')}`;
  }

  return {
    id, verdict, note,
    budgets: BUDGETS,
    batchSize: BATCH_SIZE,
    onOff: { [b1]: onOff[b1], [b2]: onOff[b2] },
    offSelf, control, short,
    runs: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, {
      arm: r.arm, budget: r.budget, code: r.code, png: r.png, log: r.log,
      painted: r.exists, crash: r.crash, crashLine: r.crashLine,
      stats: r.stats, repro: r.repro,
    }])),
  };
}

// A simple bounded worker pool: `JOBS` apps in flight, each app's own four
// runs serial inside sweepApp.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function loadavg() {
  return os.loadavg().map(n => n.toFixed(2)).join(' ');
}

function pct(d) {
  if (!d) return '-';
  if (d.sizeMismatch) return 'size≠';
  if (!d.changed) return '0';
  return `${d.changed} (${(d.share * 100).toFixed(3)}%)`;
}

(async () => {
  const startedLoad = loadavg();
  const t0 = Date.now();
  console.log(`block-exec sweep: ${ids.length} apps, budgets ${BUDGETS.join('/')} `
    + `at --batch-size=${BATCH_SIZE}, jobs ${JOBS}, loadavg ${startedLoad}`);
  if (skipped.length) {
    console.log(`skipping ${skipped.length}: ` + skipped.map(s => s.id).join(', '));
  }
  let done = 0;
  const results = await pool(ids, JOBS, async (id) => {
    const r = await sweepApp(id);
    done += 1;
    console.log(`[${done}/${ids.length}] ${id}: ${r.verdict}${r.note ? '  ' + r.note : ''}`);
    if (VERBOSE) {
      console.log(`    on-vs-off ${BUDGETS[0]}: ${pct(r.onOff[BUDGETS[0]])}  `
        + `${BUDGETS[1]}: ${pct(r.onOff[BUDGETS[1]])}  off-vs-off: ${pct(r.offSelf)}`);
    }
    return r;
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  const endedLoad = loadavg();

  const CLASSES = ['IDENTICAL', 'PACING', 'DIFFERENT', 'CRASH', 'TIMEOUT', 'NOPIC', 'NONDET'];
  const counts = Object.fromEntries(CLASSES.map(c => [c, results.filter(r => r.verdict === c).length]));
  console.log('\n' + CLASSES.map(c => `${counts[c]} ${c}`).join(', ')
    + `  (${elapsed}s, loadavg ${startedLoad} -> ${endedLoad})`);

  const payload = {
    generated: new Date().toISOString(),
    budgets: BUDGETS, batchSize: BATCH_SIZE, seconds: SECONDS, timeout: TIMEOUT,
    jobs: JOBS, tolerance: TOLERANCE,
    loadavgStart: startedLoad, loadavgEnd: endedLoad, elapsedSeconds: Number(elapsed),
    counts, skipped, results,
  };
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2));
    console.log(`wrote ${JSON_OUT}`);
  }
  if (MD_OUT) {
    fs.writeFileSync(MD_OUT, markdown(payload));
    console.log(`wrote ${MD_OUT}`);
  }
  if (SHEET_OUT) {
    const dir = path.join(SHOTS, 'flagged');
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const r of results) {
      if (r.verdict !== 'DIFFERENT' && r.verdict !== 'CRASH') continue;
      // The ON arm at the larger budget is the picture the verdict is about.
      const pick = r.runs[`on${BUDGETS[1]}`].painted ? r.runs[`on${BUDGETS[1]}`]
        : Object.values(r.runs).find(x => x.painted);
      if (!pick) continue;
      fs.copyFileSync(pick.png, path.join(dir, `${r.id}.png`));
      n += 1;
    }
    if (n) {
      const { execFileSync } = require('child_process');
      execFileSync('node', [path.join(__dirname, 'app-contact-sheet.js'),
        `--dir=${dir}`, `--out=${SHEET_OUT}`], { cwd: ROOT, stdio: 'inherit' });
    } else {
      console.log('no DIFFERENT/CRASH captures to sheet');
    }
  }
  process.exit(counts.DIFFERENT + counts.CRASH ? 1 : 0);
})();

function markdown(p) {
  const [b1, b2] = p.budgets;
  const L = [];
  L.push('# `--block-exec` registry sweep');
  L.push('');
  L.push(`Generated ${p.generated} — ${p.results.length} apps, budgets `
    + `${b1}/${b2} batches at \`--batch-size=${p.batchSize}\`, `
    + `\`--max-seconds=${p.seconds}\` under \`timeout ${p.timeout}\`, `
    + `${p.jobs} apps in flight. Box loadavg ${p.loadavgStart} → ${p.loadavgEnd} `
    + `over ${p.elapsedSeconds}s.`);
  L.push('');
  L.push('`on-vs-off` is the executor A/B at each budget; `off-vs-off` is the '
    + 'same arm photographed at the two budgets and is the null band the '
    + 'verdict is judged against.');
  L.push('');
  L.push(Object.entries(p.counts).map(([k, v]) => `**${v}** ${k}`).join(' · '));
  L.push('');
  L.push('`exercised` is the ON arm\'s `installs`/`entries` at the larger budget: '
    + 'an IDENTICAL row whose executor installed nothing proves nothing about '
    + 'the executor, and this is the column that says which rows those are.');
  L.push('');
  const hasControl = p.results.some(r => r.control);
  if (hasControl) {
    L.push(`\`control\` is the off arm at ${b2} run twice: anything but 0 there `
      + 'means the app is nondeterministic and no on-vs-off number from it counts.');
    L.push('');
  }
  L.push(`| app | verdict | on-vs-off @${b1} | on-vs-off @${b2} | off-vs-off ${b1}→${b2} `
    + `${hasControl ? `| control @${b2} ` : ''}| exercised (inst/entries/native%) | note |`);
  L.push('|---|---|---|---|---|' + (hasControl ? '---|' : '') + '---|---|');
  const order = { DIFFERENT: 0, CRASH: 1, TIMEOUT: 2, NONDET: 3, PACING: 4, NOPIC: 5, IDENTICAL: 6 };
  const rows = p.results.slice().sort((a, b) =>
    (order[a.verdict] - order[b.verdict]) || a.id.localeCompare(b.id));
  for (const r of rows) {
    const s = (r.runs[`on${b2}`] || {}).stats || {};
    const ex = s.installs == null ? '-'
      : `${s.installs}/${s.entries}/${s.nativePct ?? '-'}`;
    L.push(`| ${r.id} | ${r.verdict} | ${pct(r.onOff[b1])} | ${pct(r.onOff[b2])} `
      + `| ${pct(r.offSelf)} ${hasControl ? `| ${r.control ? pct(r.control) : '-'} ` : ''}`
      + `| ${ex} | ${r.note || ''} |`);
  }
  L.push('');
  const flagged = rows.filter(r => r.verdict === 'DIFFERENT' || r.verdict === 'CRASH'
    || r.verdict === 'TIMEOUT');
  if (flagged.length) {
    L.push('## Repro command lines');
    L.push('');
    for (const r of flagged) {
      L.push(`### ${r.id} — ${r.verdict}`);
      L.push('');
      if (r.note) L.push(r.note);
      for (const key of Object.keys(r.runs)) {
        const run = r.runs[key];
        L.push('');
        L.push(`\`\`\`sh`);
        L.push(run.repro);
        L.push('```');
        const bits = [`exit ${run.code}`, run.painted ? 'painted' : 'no png'];
        if (run.crashLine) bits.push('crash: `' + run.crashLine + '`');
        L.push(bits.join(' · '));
        if (run.stats.blockExec) L.push('`' + run.stats.blockExec + '`');
        if (run.stats.regions) L.push('`' + run.stats.regions + '`');
      }
      L.push('');
    }
  }
  if (p.skipped.length) {
    L.push('## Skipped');
    L.push('');
    L.push('| app | why |');
    L.push('|---|---|');
    for (const s of p.skipped) L.push(`| ${s.id} | ${s.why} |`);
    L.push('');
  }
  return L.join('\n');
}
