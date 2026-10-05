'use strict';

// Static source assertions must follow the same include list as the compiler.
// Reading one handler fragment makes the assertion silently disappear whenever
// source organization changes, even though the function remains in the module.

const fs = require('fs');
const path = require('path');
const { WAT_FILES } = require('../lib/wat-manifest');

const ROOT = path.join(__dirname, '..');

function readWatSourceClosure() {
  return WAT_FILES
    .map(file => fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'))
    .join('\n');
}

module.exports = { readWatSourceClosure };
