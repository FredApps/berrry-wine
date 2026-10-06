#!/usr/bin/env node
'use strict';

// The launch window (lib/launch-progress.js + index.html's .wa-launch CSS)
// never scrolls. A launch can mount thousands of files with long paths, a
// stalled download adds a status line and an error a long heading; every line
// is capped (ellipsis, a clamped heading, DETAILS_MAX_ROWS Details rows with a
// summary row), so at desktop and phone sizes the window fits the viewport
// with no scrollbar -- neither on the window nor on its Details list.
//
// Renders the real CSS and the real DOM view on a blank page (no emulator).
// Screenshots: build/launch-window-fit/<case>-<viewport>.png.
// LAUNCH_FIT_REV=<git rev> renders that revision's files instead (the
// "before" pictures), and reports instead of failing.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const REV = process.env.LAUNCH_FIT_REV || '';
const OUT = path.join(ROOT, 'build', 'launch-window-fit', REV ? `rev-${REV}` : 'current');
const CHROME = process.env.CHROME ||
  ['/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    .find(p => fs.existsSync(p));

const source = file => REV
  ? execFileSync('git', ['show', `${REV}:${file}`], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(ROOT, file), 'utf8');

const html = source('index.html');
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const script = source('lib/launch-progress.js');

const LONG = 'test/binaries/win98-games-a-d/Atlantis demo-SW/DATA/SEQUENCES/LOCATIONS/' +
  'some_really_long_directory_name/another_level_down/A_VERY_LONG_MOVIE_FILE_NAME_INTRO_PART_01.HNM';
const files = Array.from({ length: 2916 }, (_, i) => ({
  name: `${LONG.replace('01', String(i))}`, size: '1.4 MB', status: i < 2900 ? 'Done' : `${i % 97}%`,
}));
const progressModel = details => ({
  kind: 'progress', mode: 'direct', windowed: false, title: '37% of Atlantis: The Lost Tales Demo (2916 files)',
  art: 'download', heading: '', saving: `Atlantis: The Lost Tales Demo (2916 files) from wine-assembly.berrry.app`,
  bar: { determinate: true, percent: 37 },
  rows: [
    ['Estimated time left:', '4 min 12 sec (61.2 MB of 166.0 MB copied)'],
    ['Now saving:', LONG],
    ['Transfer rate:', 'Waiting — no data for 14 sec'],
    ['From cache:', '1200 of 2916 files'],
  ],
  status: [`Waiting for ${LONG} — the network is slow.`],
  buttons: [{ id: 'details', label: 'Details >>' }, { id: 'cancel', label: 'Cancel', primary: true }],
  details, announce: 'Downloading Atlantis',
});
const errorModel = details => ({
  kind: 'error', mode: 'direct', windowed: false, title: 'Atlantis: The Lost Tales Demo', art: 'none',
  heading: `Atlantis couldn't load game data (${LONG}): the server answered HTTP 503. ` +
    'Check the connection and try again; the files already downloaded are kept. '.repeat(3),
  saving: null, bar: null, rows: [['Downloaded:', '2900 files, 160.2 MB (1200 from cache)']], status: [],
  buttons: [{ id: 'details', label: 'Details >>' }, { id: 'close', label: 'Close' }, { id: 'retry', label: 'Retry', primary: true }],
  details, announce: 'Error',
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] });
  const failures = [];
  try {
    const page = await browser.newPage();
    for (const [vw, vh, touch] of [[1280, 800, false], [375, 667, true], [667, 375, true]]) {
      await page.setViewport({ width: vw, height: vh, isMobile: touch, hasTouch: touch });
      for (const [name, build] of [['progress', progressModel], ['error', errorModel]]) {
        await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width">` +
          `<style>${css}</style></head><body></body></html>`);
        await page.addScriptTag({ content: script });
        const result = await page.evaluate((modelJson, all) => {
          const model = JSON.parse(modelJson);
          // What the controller hands the view: the capped rows (current code
          // caps in the model; the older code passed every file).
          const LP = window.LaunchProgress;
          model.details = all;
          if (LP.DETAILS_MAX_ROWS && all.length > LP.DETAILS_MAX_ROWS) {
            const shown = all.slice(-(LP.DETAILS_MAX_ROWS - 1));
            model.details = [...shown, { name: `${all.length - shown.length} more files`, size: '', status: 'done' }];
          }
          const view = LP.createDomView(document, {});
          view.show(model);
          view.element.querySelector('[data-action="details"]').click();
          return new Promise(resolve => requestAnimationFrame(() => {
            const el = view.element, d = el.querySelector('.wa-launch-details');
            const r = el.getBoundingClientRect();
            resolve({
              scrolls: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
              overflowY: getComputedStyle(el).overflowY,
              detailsScrolls: !d.hidden && (d.scrollHeight > d.clientHeight + 1),
              detailsOverflowY: getComputedStyle(d).overflowY,
              detailRows: d.querySelectorAll('tbody tr').length,
              top: r.top, bottom: r.bottom, height: r.height, innerHeight,
              footVisible: el.querySelector('.wa-launch-foot').getBoundingClientRect().bottom <= r.bottom + 1,
            });
          }));
        }, JSON.stringify(build([])), files);
        const shot = path.join(OUT, `${name}-${vw}x${vh}.png`);
        await page.screenshot({ path: shot });
        const where = `${name} at ${vw}x${vh}`;
        const problems = [];
        if (result.scrolls || /auto|scroll/.test(result.overflowY)) problems.push(`window scrolls (overflow-y ${result.overflowY})`);
        if (result.detailsScrolls || /auto|scroll/.test(result.detailsOverflowY)) problems.push(`Details scrolls (${result.detailRows} rows)`);
        if (result.top < 0 || result.bottom > result.innerHeight) problems.push(`off screen (${Math.round(result.top)}..${Math.round(result.bottom)} of ${result.innerHeight})`);
        if (!result.footVisible) problems.push('buttons clipped');
        console.log(`${problems.length ? 'FAIL' : 'ok  '} ${where}: height ${Math.round(result.height)}/${result.innerHeight}, ` +
          `${result.detailRows} Details rows${problems.length ? ' -- ' + problems.join('; ') : ''}`);
        if (problems.length) failures.push(`${where}: ${problems.join('; ')}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`screenshots: ${path.relative(ROOT, OUT)}`);
  if (REV) return;
  assert.deepStrictEqual(failures, [], 'the launch window must fit without scrolling');
  console.log('PASS launch window fits desktop, portrait and landscape phone without a scrollbar');
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
