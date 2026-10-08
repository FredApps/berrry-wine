#!/usr/bin/env node
'use strict';
// Original GOG bytes only. Save templates are mounted into the original overlay;
// browser persistence restores user saves after these defaults, before execution.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function prepare(root, source) {
  function verify(rel, bytes, digest) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw Error('Unsafe source member');
    const file = path.join(root, rel), data = fs.readFileSync(file);
    if (!fs.statSync(file).isFile() || data.length !== bytes || sha(data) !== digest) throw Error('Original fixture mismatch: ' + rel);
    return data;
  }
  verify(source.installer.path, source.installer.bytes, source.installer.sha256);
  const candidate = path.dirname(source.installedRoot);
  const files = source.files.map(e => {
    verify(source.installedRoot + '/' + e.path, e.bytes, e.sha256);
    return {url:'installed/' + e.path, vfsPath:'c:\\' + e.path.replaceAll('/', '\\'), size:e.bytes, sha256:e.sha256};
  });
  // Direct aliases retain immutable original bytes. No host user-save file is
  // opened, copied over, or deleted by this recipe.
  for (const name of source.saveOverlay.templates) {
    const entry = source.files.find(e => e.path === name);
    if (!entry || !/^__support\/save\/[A-Za-z0-9_]+\.SAV$/.test(name)) throw Error('Invalid original save template');
    files.push({url:'installed/' + name, vfsPath:'c:\\cloud_saves\\' + path.basename(name), size:entry.bytes, sha256:entry.sha256});
  }
  const config = fs.readFileSync(path.join(root, source.config.path));
  if (sha(config) !== source.config.sha256) throw Error('Documented DOSBox config changed');
  if (!config.toString().includes('mount C C:\\\nmount C C:\\cloud_saves -t overlay\n')) throw Error('Original overlay order missing');
  files.push({url:'ultima4-wa.conf',vfsPath:'c:\\ultima4-wa.conf',size:config.length,sha256:source.config.sha256});
  const manifest = Buffer.from(JSON.stringify({schemaVersion:1,source:'Original GOG payload and save templates; original cloud_saves overlay; persisted user saves restored before execution',files},null,2)+'\n');
  const outputs = [
    {file:path.join(root,candidate,'ultima4-wa.conf'),data:config,previous:source.config.previousSha256},
    {file:path.join(root,candidate,'.wine-assembly-browser.json'),data:manifest,previous:source.config.previousManifestSha256}
  ];
  // Validate ALL outputs before changing either. Only precisely pinned old
  // generated metadata is upgradeable; unrelated state is a hard conflict.
  for (const out of outputs) {
    out.old = fs.existsSync(out.file) ? fs.readFileSync(out.file) : null;
    if (out.old && !out.old.equals(out.data) && sha(out.old) !== out.previous) throw Error('Existing generated metadata conflict: ' + out.file);
  }
  for (const out of outputs) {
    if (out.old && out.old.equals(out.data)) continue;
    if (!out.old) fs.writeFileSync(out.file,out.data,{flag:'wx'});
    else {
      const backup = out.file + '.before-' + sha(out.old);
      if (fs.existsSync(backup)) { if (!fs.readFileSync(backup).equals(out.old)) throw Error('Backup conflict'); }
      else fs.writeFileSync(backup,out.old,{flag:'wx'});
      if (!fs.readFileSync(out.file).equals(out.old)) throw Error('Concurrent metadata change');
      const temp = out.file + '.tmp-' + process.pid;
      fs.writeFileSync(temp,out.data,{flag:'wx'}); fs.renameSync(temp,out.file);
    }
  }
  return {originalFiles:source.files.length,saveTemplateAliases:source.saveOverlay.templates.length,manifestEntries:files.length,configSha256:sha(config),manifestSha256:sha(manifest)};
}
module.exports = {prepare};
if (require.main === module) console.log(JSON.stringify(prepare(path.resolve(__dirname,'..'),require('../lib/ultima4-gog-source.json')),null,2));
