'use strict';

// Reconstruct a selected MSI install tree from already extracted cabinets.
// This copies payload bytes only; it does not execute installer custom actions.
const fs = require('fs');
const path = require('path');
const { openMsi } = require('./msi-tables');

function safePart(value) {
  if (!value || /[\\/]/.test(value) || value === '..' || path.isAbsolute(value)) {
    throw new Error(`unsafe MSI path component: ${value}`);
  }
  return value;
}

function longName(value) {
  return safePart(value.split('|').pop());
}

function installMsiFiles({ msiFile, cabinetRoot, sourceRoot, destination, rootDirectory = 'INSTALLDIR', directoryAliases = {} }) {
  const msi = openMsi(msiFile);
  const directories = new Map(msi.rows('Directory').map(row => [row.Directory, row]));
  const components = new Map(msi.rows('Component').map(row => [row.Component, row]));
  if (!directories.has(rootDirectory)) throw new Error(`missing MSI directory ${rootDirectory}`);
  for (const relative of Object.values(directoryAliases)) {
    if (relative !== '.') safePart(relative);
  }
  function directory(id, source, seen = new Set()) {
    if (!source && id === rootDirectory) return '';
    if (!source && Object.hasOwn(directoryAliases, id)) return directoryAliases[id];
    if (seen.has(id)) throw new Error(`cyclic MSI directory ${id}`);
    seen.add(id);
    const row = directories.get(id);
    if (!row) throw new Error(`missing MSI directory ${id}`);
    if (!row.Directory_Parent) return source ? '' : null;
    const parent = directory(row.Directory_Parent, source, seen);
    if (parent === null) return null;
    const names = row.DefaultDir.split(':');
    const leaf = longName(source ? (names[1] || names[0]) : names[0]);
    return leaf === '.' ? parent : path.join(parent, leaf);
  }
  const copies = [];
  const targets = new Set();
  for (const file of msi.rows('File')) {
    const component = components.get(file.Component_);
    if (!component) throw new Error(`missing MSI component ${file.Component_}`);
    const relative = directory(component.Directory_, false);
    if (relative === null) continue;
    const name = longName(file.FileName);
    const target = path.join(destination, relative, name);
    const key = target.toLowerCase();
    if (targets.has(key)) throw new Error(`duplicate MSI target ${target}`);
    targets.add(key);
    const source = (file.Attributes & 8192)
      ? path.join(sourceRoot, directory(component.Directory_, true), name)
      : path.join(cabinetRoot, safePart(file.File));
    if (!fs.statSync(source).isFile()) throw new Error(`missing MSI payload ${source}`);
    // Loose EXEs on budget reissues can be newer than the MSI FileSize field.
    if (!(file.Attributes & 8192) && fs.statSync(source).size !== file.FileSize) {
      throw new Error(`MSI payload size mismatch: ${source}`);
    }
    copies.push({ source, target });
  }
  for (const { source, target } of copies) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // CAB read-only attributes should not prevent repeating preparation.
    if (fs.existsSync(target)) fs.chmodSync(target, 0o644);
    fs.copyFileSync(source, target);
    fs.chmodSync(target, 0o644);
  }
  return copies.length;
}

module.exports = { installMsiFiles };
