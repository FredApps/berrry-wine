'use strict';
// Search a PDF page range (1-based, inclusive) of pdftotext output for a regex.
//   node sdm-range.js sdm.txt FROM TO '<regex>'
const fs = require('fs');
const [file, from, to, pat] = process.argv.slice(2);
const pages = fs.readFileSync(file, 'utf8').split('\f');
const re = new RegExp(pat, 'i');
let n = 0;
for (let p = Number(from); p <= Number(to); p++) {
  const folio = (pages[p - 1].match(/Vol\. \d[A-D]? \d+-\d+/) || pages[p - 1].match(/\d+-\d+ Vol\. \d[A-D]?/) || ['?'])[0];
  for (const l of pages[p - 1].split('\n')) if (re.test(l)) { n++; console.log(`pdf ${p} [${folio}]: ${l.trim()}`); }
}
console.log(`${n} matching line(s) in pdf pages ${from}-${to}`);
