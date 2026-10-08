'use strict';
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), crypto = require('node:crypto');
const { instrument } = require('./instrument');
function install(root, expectedSha256) {
  const filename = path.join(root, 'tools/toyvm/emit.js');
  if (require.cache[filename]) throw Error('emitter already loaded; fresh diagnostic process required');
  const source = fs.readFileSync(filename, 'utf8'), digest = s => crypto.createHash('sha256').update(s).digest('hex');
  if (digest(source) !== expectedSha256) throw Error('emitter source drift');
  const transformed = instrument(source);
  const injected = new Module(filename, module); injected.filename = filename; injected.paths = Module._nodeModulePaths(path.dirname(filename));
  injected._compile(transformed, filename); require.cache[filename] = injected;
  return { originalSha256: digest(source), privateSha256: digest(transformed), restore() {
    if (require.cache[filename] !== injected) return false;
    delete require.cache[filename]; return true;
  } };
}
module.exports = { install };
