#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const MAX_BYTES = 32768;

function checkSize(file = path.resolve(__dirname, '../CLAUDE.md')) {
  const bytes = fs.readFileSync(file).length;
  if (bytes > MAX_BYTES) {
    throw new Error(`CLAUDE.md is ${bytes} bytes (limit ${MAX_BYTES}); add details to docs/ instead.`);
  }
  return bytes;
}

if (require.main === module) {
  try {
    console.info(`CLAUDE.md size: ${checkSize(process.argv[2])}/${MAX_BYTES} bytes`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkSize, MAX_BYTES };
