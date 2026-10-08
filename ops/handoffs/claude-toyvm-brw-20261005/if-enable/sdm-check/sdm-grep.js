'use strict';
// Search pdftotext -layout output of the Intel SDM page by page (form feeds),
// printing the PDF page number, the printed folio ("Vol. 3A 7-25") and context.
//   node sdm-grep.js sdm.txt '<regex>' [context-lines=6] [max=10]
const fs = require('fs');
const [file, pat, ctxArg, maxArg] = process.argv.slice(2);
const ctx = Number(ctxArg || 6), max = Number(maxArg || 10);
const re = new RegExp(pat, 'i');
const pages = fs.readFileSync(file, 'utf8').split('\f');
let hits = 0;
for (let p = 0; p < pages.length && hits < max; p++) {
  const lines = pages[p].split('\n');
  const folio = (pages[p].match(/Vol\. \d[A-D]? \d+-\d+/) || pages[p].match(/\d+-\d+ Vol\. \d[A-D]?/) || ['?'])[0];
  for (let i = 0; i < lines.length && hits < max; i++) {
    if (!re.test(lines[i])) continue;
    hits++;
    console.log(`--- pdf page ${p + 1} [${folio}] line ${i + 1}`);
    console.log(lines.slice(Math.max(0, i - ctx), i + ctx + 1).map((l) => l.trim()).filter(Boolean).join('\n'));
  }
}
if (!hits) console.log('no match');
