#!/usr/bin/env node
// Which packages make up the bundled wine-agent.mjs: esbuild metafile, grouped
// by package, largest first. For deciding what can be stubbed out.
'use strict';
const path = require('path');
const esbuild = require('esbuild');

(async () => {
  const r = await esbuild.build({
    entryPoints: [path.join(__dirname, 'wine-agent.js')],
    bundle: true, platform: 'node', format: 'esm', minify: true, write: false, metafile: true,
    logLevel: 'silent',
  });
  const out = Object.values(r.metafile.outputs)[0];
  const byPkg = {};
  for (const [file, info] of Object.entries(out.inputs)) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file);
    const key = m ? m[1] : file.replace(/^.*?(lib|tools)\//, '$1/');
    byPkg[key] = (byPkg[key] || 0) + info.bytesInOutput;
  }
  for (const [k, v] of Object.entries(byPkg).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`${(v / 1024).toFixed(0).padStart(6)} KB  ${k}`);
  }
})();
