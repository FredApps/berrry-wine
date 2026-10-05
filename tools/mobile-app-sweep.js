#!/usr/bin/env node
'use strict';

// Photograph every desktop app at a phone's screen size, twice per orientation:
// once at rest, and once after doing the few keystrokes that get the app past
// its own front door. Then record how the page placed the picture.
//
//   sweep --out=DIR --apps=a,b        for each id, for each orientation:
//     |                                 launch in the SHIPPING shell (no ?debug)
//     |                                 at 375x667 / 667x375, touch emulation on
//     +-- wait for the guest to settle -> shot  <out>/<orient>/<id>-rest.png
//     +-- run the id's recipe ----------> shot  <out>/<orient>/<id>.png
//     +-- read the layout out of the page -> one row in <out>/measurements.json
//
// Why the second shot exists: the first one is usually not the app. Taipei
// opens on an empty green baize and deals nothing until Game/New; Four Stones,
// Funtris and Peaks open behind an About box; Blobby Volley waits on a key.
// A contact sheet of first frames is a sheet of splash screens and empty
// boards, which says nothing about whether the app's own artwork is being fit,
// filled or cut off -- which is the whole question this sweep exists to answer.
// So each id carries a recipe, and the recipes are three classes, not 36
// bespoke scripts:
//
//   menu-game  Enter (answer a box), then F2 -- "New Game" in every Win98 and
//              Entertainment Pack title here, which is what deals the cards or
//              lays out the tiles.
//   key-start  Enter, Enter, Space -- a title screen waiting to be told to go.
//   plain      Enter alone -- an accessory has a document already; the only
//              thing in the way is a possible startup notice.
//
// Recipes are best-effort and idempotent-ish by design: F2 in an app with no
// New Game does nothing, and Enter into a text window types a newline. Where
// that is not true (RegEdit's F2 renames the selected key) the app is in
// `plain` instead. Nothing here interprets the picture; that is the reviewer's
// job with tools/app-contact-sheet.js.
//
// The measurement is taken at the END, on the app in the state the second shot
// shows, because a window's size and the page's fit/fill decision both change
// when the real app window finally appears.
//
// usage: node tools/mobile-app-sweep.js --out=DIR [--apps=a,b] [--orientations=portrait,landscape]
//                                       [--settle=14000] [--jobs=4] [--timeout=240]
//                                       [--url=http://127.0.0.1:8080] [--query=mm-thread=0]

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const PROBE = path.join(REPO, 'tools', 'web-input-probe.js');

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};

const OUT = arg('out');
if (!OUT) {
  console.error('need --out=DIR');
  process.exit(2);
}
const SETTLE = Number(arg('settle', 14000));
const JOBS = Math.max(1, Number(arg('jobs', 4)));
const TIMEOUT_S = Number(arg('timeout', 240));
// Passed through to the probe's wait for the app to exist. The heavy apps
// (Winamp, StarCraft, Heroes II, RollerCoaster Tycoon) do not make the 90s
// default on a loaded box and report as launch failures they are not.
const LAUNCH_MS = Number(arg('launch', 150000));
const URL_BASE = arg('url', '');
// Extra page switches on top of the shipping shell, e.g. `mm-thread=0`, so
// one build can be swept both ways without an edit.
const QUERY = String(arg('query', '')).replace(/^\?/, '');

const ORIENTS = {
  portrait: '375x667',   // iPhone SE, the smallest screen we claim to support
  landscape: '667x375',
};
const WANT_ORIENTS = arg('orientations', 'portrait,landscape').split(',').filter(Boolean);

// --- what gets an app past its front door -----------------------------------

const MENU_GAME = ['key:Enter', 'wait:1000', 'key:F2', 'wait:3500'];
const KEY_START = ['key:Enter', 'wait:1200', 'key:Enter', 'wait:1200', 'key:Space', 'wait:3000'];
const PLAIN = ['key:Enter', 'wait:1500'];
// For an app where even Enter is destructive. Task Manager's window is a list
// of tasks with "Switch To" as the default button, so Enter on it leaves Task
// Manager -- the sweep photographed an empty desktop and it read as a phone
// bug until the -rest shot showed the window had been there all along.
const NONE = [];

const RECIPE_CLASS = {
  'menu-game': MENU_GAME,
  'key-start': KEY_START,
  plain: PLAIN,
  none: NONE,
};

const CLASS_OF = {
  blobby_volley: 'key-start',
  bricks: 'key-start',
  calc: 'plain',
  cruel: 'menu-game',
  cwordzap: 'menu-game',
  dxball: 'key-start',
  empipe: 'key-start',
  fourstones: 'menu-game',
  freecell: 'menu-game',
  funtris: 'key-start',
  golf: 'menu-game',
  heroes2_demo: 'key-start',
  marbles: 'key-start',
  mspaint98: 'plain',
  notepad: 'plain',
  peaks: 'key-start',
  pegged: 'menu-game',
  pinball: 'key-start',
  pyramid: 'menu-game',
  qblackjack: 'menu-game',
  rct: 'key-start',
  regedit: 'plain',       // F2 here renames the selected key, so no F2.
  reversi: 'menu-game',
  ski32: 'key-start',
  snake: 'menu-game',
  sndrec32_98: 'plain',
  sol: 'menu-game',
  spider: 'menu-game',
  starcraft_shareware: 'key-start',
  taipei: 'menu-game',
  taskman: 'none',    // Enter is "Switch To", which closes Task Manager.
  tictac: 'menu-game',
  wep16_rodent: 'menu-game',
  winamp: 'plain',
  winmine_wep: 'menu-game',
  wordpad: 'plain',
};

const recipeFor = id => RECIPE_CLASS[CLASS_OF[id] || 'plain'];

// --- what the page is asked about --------------------------------------------

// One expression producing one object. Everything in it is state the page
// already computed for itself; nothing is measured here that the renderer does
// not use to place the picture.
//
// It must contain no `;` -- the probe splits its --steps list on semicolons,
// so an `eval:` step carrying one is truncated into nonsense. That is why this
// is an expression rather than a little program.
const LAYOUT_OBJ = `({
  mode: sharedRenderer.viewMode,
  canvas: [sharedRenderer.canvas.width, sharedRenderer.canvas.height],
  cbox: [sharedRenderer.canvas.clientWidth, sharedRenderer.canvas.clientHeight],
  out: [sharedRenderer.presentationCanvas ? sharedRenderer.presentationCanvas.width : 0,
        sharedRenderer.presentationCanvas ? sharedRenderer.presentationCanvas.height : 0],
  vp: sharedRenderer._exclusivePresentationViewport && (v => ({
        dst: [v.dstX, v.dstY, v.dstW, v.dstH], crop: [v.cropX, v.cropY, v.cropW, v.cropH],
        out: [v.outputW, v.outputH], bg: v.background, inset: v.bottomInset
      }))(sharedRenderer._exclusivePresentationViewport),
  excl: !!sharedRenderer._exclusiveFullscreen,
  crop: sharedRenderer.mobileCrop || null,
  keepAspect: !!sharedRenderer.singleAppKeepAspect,
  share: sharedRenderer.singleAppStageShare(),
  board: window.TouchControls && window.TouchControls.getBoardArea ? window.TouchControls.getBoardArea() : null,
  controls: !!(window.TouchControls && window.TouchControls.isVisible && window.TouchControls.isVisible()),
  wins: Object.values(sharedRenderer.windows).filter(w => w && !w.isChild && w.visible)
          .map(w => [w.className, w.x, w.y, w.w, w.h, !!w._maximized])
})`;

// --- driving one run ----------------------------------------------------------

function runOne(id, orient) {
  const dir = path.join(OUT, orient);
  fs.mkdirSync(dir, { recursive: true });
  const restShot = path.join(dir, `${id}-rest.png`);
  const shot = path.join(dir, `${id}.png`);
  const fillShot = path.join(dir, `${id}-fill.png`);
  // Both view modes in one launch. Fit is the default the app opens in, so it
  // is measured first and parked on the page; then the same running app is
  // flipped to Fill and measured again. Two launches would compare two
  // different games -- a fresh deal, a different random level -- and the
  // question is about presentation, so the app must be held still.
  const steps = [
    `wait:${SETTLE}`,
    `shot:${restShot}`,
    ...recipeFor(id),
    `shot:${shot}`,
    `eval:window.__fit = ${LAYOUT_OBJ}`,
    `eval:sharedRenderer.setViewMode('zoom')`,
    'wait:1500',
    `shot:${fillShot}`,
  ].join(';');

  // --query='' is the SHIPPING shell. The probe's default is ?debug, which puts
  // a toolbar above the stage -- a different layout from the one a phone user
  // gets, and every number below describes the layout.
  // --query=mm-thread=0 (no '?') adds A/B switches to that shell.
  const args = [PROBE, `--app=${id}`, `--query=${QUERY ? '?' + QUERY : ''}`, `--viewport=${ORIENTS[orient]}`,
    `--launch=${LAUNCH_MS}`, '--touch', `--steps=${steps}`,
    `--eval=JSON.stringify({fit: window.__fit, fill: ${LAYOUT_OBJ}})`];
  if (URL_BASE) args.push(`--url=${URL_BASE}`);

  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: REPO });
    let out = '';
    const kill = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_S * 1000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      clearTimeout(kill);
      fs.writeFileSync(path.join(dir, `${id}.log`), out);
      const line = out.split('\n').find(l => l.startsWith('eval => '));
      let both = null, error = null;
      if (line) {
        // The probe prints the evaluated value already JSON-encoded, so the
        // payload is a JSON string containing JSON.
        try { both = JSON.parse(JSON.parse(line.slice('eval => '.length))); }
        catch (e) { error = `unparsable eval: ${e.message}`; }
      } else {
        error = `no eval line (exit ${code})`;
      }
      resolve({
        id, orient, viewport: ORIENTS[orient], recipe: CLASS_OF[id] || 'plain',
        restShot: fs.existsSync(restShot) ? restShot : null,
        shot: fs.existsSync(shot) ? shot : null,
        fillShot: fs.existsSync(fillShot) ? fillShot : null,
        exit: code, error,
        layout: both && both.fit || null,
        fill: both && both.fill || null,
      });
    });
  });
}

// --- main ---------------------------------------------------------------------

(async () => {
  let ids = arg('apps', '').split(',').filter(Boolean);
  if (!ids.length) {
    const apps = require(path.join(REPO, 'lib', 'apps.js'));
    ids = apps.DESKTOP_APPS.map(row => row[0]);
  }
  const jobs = [];
  for (const id of ids) for (const orient of WANT_ORIENTS) jobs.push([id, orient]);

  fs.mkdirSync(OUT, { recursive: true });
  const rowsPath = path.join(OUT, 'measurements.json');
  // Merge, never replace. A sweep is routinely re-run for the handful of apps
  // that failed, into the same --out because that is where their screenshots
  // belong -- and a plain overwrite then throws away the 50-odd rows that
  // succeeded the first time while leaving their PNGs in place, so the
  // directory says one thing and the measurements another.
  const rows = [];
  if (fs.existsSync(rowsPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
      const rerunning = new Set(jobs.map(([id, orient]) => `${id} ${orient}`));
      for (const row of prior) {
        if (!rerunning.has(`${row.id} ${row.orient}`)) rows.push(row);
      }
    } catch (_) { /* unreadable or truncated: start over rather than fail */ }
  }
  const keptFromPrior = rows.length;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [id, orient] = jobs[next++];
      const row = await runOne(id, orient);
      rows.push(row);
      // Written after every run: a sweep this long is usually read while it is
      // still going, and a partial file beats no file if it is interrupted.
      fs.writeFileSync(rowsPath, JSON.stringify(rows, null, 1));
      console.log(`${rows.length - keptFromPrior}/${jobs.length}  ${id} ${orient}` +
        (row.error ? `  ERROR ${row.error}` : ''));
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, worker));
  console.log(`wrote ${rowsPath}`);
})();
