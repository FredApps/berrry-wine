'use strict';

// This handler is mounted behind the existing authenticated gateway. It serves
// a closed runtime/registered-fixture namespace, never an arbitrary repo path.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const PREFIX = '/emulator/';
const LOCAL_DESKTOP = "    const LOCAL_DESKTOP = !new URLSearchParams(location.search).has('prod') &&\n      /^(localhost|127\\.|0\\.0\\.0\\.0|::1$|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/.test(location.hostname);";
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const caches = new Map(), buildCaches = new Map(), wasmDigests = new Map();
const WASM = 'build/wine-assembly.wasm';
function localPath(value) {
  if (typeof value !== 'string' || !value || /[\\\0?#]/.test(value) || path.posix.isAbsolute(value) || /^[a-z]+:/i.test(value)) return null;
  if (value.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return value;
}
function fileUrl(value) { return typeof value === 'string' ? value : value?.url; }
function manifestAsset(manifest, value, appId, app) {
  const name = fileUrl(value);
  if (typeof name !== 'string' || !name || /[\\\0?#]/.test(name) || path.posix.isAbsolute(name) || /^[a-z]+:/i.test(name)) return null;
  // Installed manifests can explicitly name sibling MUSIC/SPEECH directories.
  // Resolve those declarations before validation, but never leave fixture roots.
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(manifest), name));
  // This legacy demo is deliberately packaged in build/ (see the NFS renderer
  // notes). Bind the exception to the exact registry identity and fixture;
  // neither arbitrary build files nor a manifest-selected root are trusted.
  const nfsFixture = appId === 'nfs2se_glide_demo' &&
    manifest === 'build/nfs2se-browser.json' &&
    app.exe === 'build/nfs2se-demo/NFS2SEA.EXE' &&
    resolved.startsWith('build/nfs2se-demo/');
  return /^(?:test\/)?binaries\//.test(resolved) || nfsFixture ? localPath(resolved) : null;
}
async function realFile(root, relative) {
  if (!localPath(relative)) return null;
  try {
    const real = await fsp.realpath(path.join(root, relative));
    // The sole supported alias is the repository's binaries -> test/binaries.
    // A replaced allowlisted file must not point at another private repo file.
    const expected = path.join(root, relative.replace(/^binaries\//, 'test/binaries/'));
    if (real !== expected || !real.startsWith(root + path.sep) || !(await fsp.stat(real)).isFile()) return null;
    return real;
  } catch { return null; }
}
async function collectTree(root, dir, extensions, files) {
  let entries; try { entries = await fsp.readdir(path.join(root, dir), {withFileTypes:true}); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const name = dir + '/' + entry.name;
    if (entry.isDirectory()) await collectTree(root, name, extensions, files);
    else if (entry.isFile() && extensions.has(path.extname(name).toLowerCase())) files.add(name);
  }
}
async function buildCatalog(inputRoot) {
  const root = await fsp.realpath(inputRoot), allowed = new Set(['index.html','host.js','build-info.js','sw-coi.js','manifest.webmanifest','lib/app-icon-manifest.json','lib/host-import-sigs.generated.json','src/api_table.json','test/binaries/tlbs/stdole2.tlb','build/wine-assembly.wasm','build/wine-assembly.compat.wasm']);
  await collectTree(root, 'lib', new Set(['.js']), allowed);
  await collectTree(root, 'fonts', new Set(['.ttf','.otf','.woff','.woff2','.fon','.fnt','.bin','.png','.json']), allowed);
  await collectTree(root, 'icons', new Set(['.png','.ico','.svg','.jpg','.gif','.webp']), allowed);
  let registry = {}, labels = new Map();
  const registryPath = await realFile(root, 'lib/apps.js');
  if (registryPath) {
    const data = require(registryPath); registry = data.APPS || {};
    labels = new Map([...(data.DESKTOP_APPS || []), ...(data.LOCAL_CANDIDATE_APPS || []), ...(data.DEBUG_ONLY_APPS || [])].map(row => [row[0],row[1]]));
  }
  const dllFile = await realFile(root, 'lib/dll-registry.js');
  if (dllFile) for (const name of Object.values(require(dllFile).DLL_PATHS || {})) if (localPath(name)) allowed.add(name);
  const routes = [];
  for (const [appId, app] of Object.entries(registry)) {
    const dependencies = new Set(), invalid = [];
    const add = value => { const name = localPath(fileUrl(value)); if (name) { dependencies.add(name); allowed.add(name); } else if (value) invalid.push('Unsupported registered asset path'); };
    add(app.exe); for (const value of [...(app.files || []), ...(app.dlls || [])]) add(value);
    if (app.iconFile) add(app.iconFile);
    if (app.localFileManifest) {
      add(app.localFileManifest);
      const manifestFile = await realFile(root, app.localFileManifest);
      if (manifestFile) {
        try {
          const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
          if (!Array.isArray(manifest.files)) throw Error('Expected files array');
          for (const value of manifest.files) {
            const name = manifestAsset(app.localFileManifest, value, appId, app);
            if (!name) { invalid.push('Unsupported manifest asset path'); continue; }
            add(name);
          }
        } catch { invalid.push('Invalid registered file manifest'); }
      }
    }
    if (app.cdAudio?.cue) {
      add(app.cdAudio.cue);
      const cue = await realFile(root, app.cdAudio.cue);
      if (cue) for (const match of (await fsp.readFile(cue,'utf8')).matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+/gim)) {
        const name = localPath((match[1] || match[2]).replaceAll('\\','/'));
        if (name) add(path.posix.join(path.posix.dirname(app.cdAudio.cue), name)); else invalid.push('Unsupported CUE dependency');
      }
    }
    const missingPaths = [];
    for (const name of dependencies) if (!await realFile(root, name)) missingPaths.push(name);
    const available = !!localPath(fileUrl(app.exe)) && !missingPaths.length && !invalid.length;
    routes.push({appId,label:labels.get(appId) || appId,available,url:available ? PREFIX + '?app=' + encodeURIComponent(appId) : null,
      reason:available ? 'Registered local files are present; launch does not certify compatibility.' : invalid[0] || 'Registered files are missing.',missingPaths});
  }
  return {root,allowed,routes};
}
async function getCatalog(root) {
  const key = path.resolve(root), old = caches.get(key);
  if (old && Date.now() - old.at < 30000) return old.promise;
  const record = {at:Date.now(),promise:buildCatalog(key)}; caches.set(key,record);
  try { return await record.promise; } catch (error) { caches.delete(key); throw error; }
}
function git(root, args) {
  return new Promise(resolve => execFile('git', ['-C', root, ...args], {timeout: 5000, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => resolve(error ? null : String(stdout))));
}
// SHA-256 of the module the emulator route would serve right now, cached by
// size + mtime so a rebuild is noticed on the next request.
async function servedWasm(root) {
  const file = await realFile(root, WASM);
  if (!file) return {sha256: null, bytes: null, modifiedAt: null};
  const stat = await fsp.stat(file), key = file + ':' + stat.size + ':' + stat.mtimeMs, old = wasmDigests.get(file);
  if (old?.key === key) return old.value;
  const value = {sha256: crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex'), bytes: stat.size, modifiedAt: stat.mtime.toISOString()};
  wasmDigests.set(file, {key, value});
  return value;
}
// What a launch actually runs: the live tree's wasm plus the checkout it sits
// in. Nothing is assumed when git or the module is unavailable.
async function readBuildIdentity(inputRoot) {
  const root = await fsp.realpath(inputRoot);
  const [wasm, head, status] = await Promise.all([servedWasm(root), git(root, ['rev-parse', 'HEAD']), git(root, ['status', '--porcelain', '--untracked-files=no'])]);
  const commit = head && /^[0-9a-f]{40}$/.test(head.trim()) ? head.trim() : null;
  const dirtyFiles = commit && status !== null ? status.split('\n').filter(Boolean).length : null;
  return {commit, dirty: dirtyFiles === null ? null : dirtyFiles > 0, dirtyFiles, wasmSha256: wasm.sha256, wasmBytes: wasm.bytes, wasmModifiedAt: wasm.modifiedAt,
    checkedAt: new Date().toISOString(), reason: !wasm.sha256 ? WASM + ' is missing; launches cannot load a module.' : '',
    note: 'Launches serve the live working tree. Dirty counts tracked files with uncommitted changes, which may or may not affect the module.'};
}
async function getBuildIdentity(root) {
  const key = path.resolve(root), old = buildCaches.get(key);
  if (old && Date.now() - old.at < 30000) return old.promise;
  const record = {at: Date.now(), promise: readBuildIdentity(key)}; buildCaches.set(key, record);
  try { return await record.promise; } catch (error) { buildCaches.delete(key); throw error; }
}
function privateIndex(bytes) {
  const source = bytes.toString('utf8');
  if (source.split(LOCAL_DESKTOP).length !== 2) throw Error('Private emulator entry anchor changed');
  return Buffer.from(source.replace(LOCAL_DESKTOP, '    const LOCAL_DESKTOP = true; // Authenticated private emulator only.'));
}
function rangeFor(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return false;
  if ([match[1],match[2]].filter(Boolean).some(value => !Number.isSafeInteger(Number(value)))) return false;
  let start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  let end = match[1] ? (match[2] ? Math.min(Number(match[2]),size-1) : size-1) : size-1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size || (!match[1] && Number(match[2]) === 0)) return false;
  return {start,end};
}
function createEmulatorHandler(root) {
  return async function serve(req,res) {
    const raw = req.url.split('?')[0];
    if (raw !== '/emulator' && !raw.startsWith(PREFIX)) return false;
    const fail = (status,message,headers={}) => {res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8',...headers});res.end(req.method === 'HEAD' ? undefined : message);return true;};
    if (!['GET','HEAD'].includes(req.method)) return fail(405,'Read-only emulator route',{Allow:'GET, HEAD'});
    if (raw === '/emulator') {res.writeHead(308,{Location:PREFIX+(req.url.includes('?')?'?'+req.url.split('?').slice(1).join('?'):'')});res.end();return true;}
    let relative;
    try { relative = decodeURIComponent(raw.slice(PREFIX.length)) || 'index.html'; } catch { return fail(400,'Invalid path'); }
    if (/%2f|%5c/i.test(raw) || !localPath(relative)) return fail(403,'Path not allowed');
    const catalog = await getCatalog(root);
    if (!catalog.allowed.has(relative)) return fail(404,'File is outside the emulator allowlist');
    if (relative === 'index.html') {
      const app = new URL(req.url,'http://localhost').searchParams.get('app');
      if (app) {const route = catalog.routes.find(route => route.appId === app);if (!route) return fail(404,'Unknown registered app');if (!route.available) return fail(409,'Registered app files are unavailable: '+(route.missingPaths.length ? 'missing '+route.missingPaths.join(', ') : route.reason));
        // A dashboard link pins the module it displayed; refuse rather than silently run another build.
        const pinned = new URL(req.url,'http://localhost').searchParams.get('build');
        if (pinned) { const served = await servedWasm(catalog.root); if (served.sha256 !== pinned) return fail(409,'Served build changed since the dashboard snapshot: link expects wasm '+pinned.slice(0,12)+', now '+(served.sha256 ? served.sha256.slice(0,12) : 'missing')+'. Refresh the dashboard and launch again.'); }}
    }
    const file = await realFile(catalog.root, relative);
    if (!file) return fail(404,'Registered runtime or asset file is missing');
    const stat = await fsp.stat(file);
    const html = relative === 'index.html' ? privateIndex(await fsp.readFile(file)) : null;
    const size = html ? html.length : stat.size, range = rangeFor(req.headers.range,size);
    if (range === false) return fail(416,'Invalid range',{'Content-Range':'bytes */'+size});
    const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.jpg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2'}[path.extname(relative).toLowerCase()] || 'application/octet-stream';
    const headers = {'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",'Accept-Ranges':'bytes','Content-Length':range ? range.end-range.start+1:size};
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    res.writeHead(range ? 206:200,headers);
    if (req.method === 'HEAD') res.end();
    else if (html) res.end(range ? html.subarray(range.start,range.end+1) : html);
    else {const stream=fs.createReadStream(file,range || {});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}
    return true;
  };
}
function launchFor(candidate,catalog,production,build) {
  const pin = build?.wasmSha256 && /^[0-9a-f]{64}$/.test(build.wasmSha256) ? '&build=' + build.wasmSha256 : '';
  const ids = candidate.appIds || [], routes=ids.map(id=>catalog.routes.find(route=>route.appId===id)).filter(Boolean).map(route=>route.available && route.url && pin ? {...route,url:route.url+pin} : route);
  const deployed = new Set(production?.status === 'verified' ? production.appIds : []);
  const productionRoutes = production?.status === 'verified' ? ids.filter(id=>deployed.has(id)).map(appId=>({appId,label:routes.find(r=>r.appId===appId)?.label || appId,url:new URL('/?app='+encodeURIComponent(appId),production.url).href})) : [];
  return {routes,productionRoutes,reason:routes.length ? '' : 'No registered emulator launch route is associated with this corpus entry.'};
}
module.exports={createEmulatorHandler,getCatalog,buildCatalog,getBuildIdentity,readBuildIdentity,privateIndex,rangeFor,launchFor,LOCAL_DESKTOP};
