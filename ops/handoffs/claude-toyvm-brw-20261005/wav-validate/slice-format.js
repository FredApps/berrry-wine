'use strict';
// The slice-record line format of run-dos.js's afterSlice hook (base 2683a6e3):
//   `${dispatched} ${left} ${cs.toString(16)}:${ip.toString(16)}`
//   + (sliceLogRegs ? ' ' + [...REG16, ...SEG].map(n => vm.get(n).toString(16)).join(',')
//                     + ',' + (vm.get('flags') >>> 0).toString(16) : '')
// Widths: dispatched < 1e9 (9), left an int32 (11 with sign), cs 4 hex, ip 8
// hex: 35 + newline. Each of the 14 registers' toString(16) is at most 9 chars
// (an int32 with sign), flags 8: + 1 + 14*9 + 14 commas + 8 = 149, so 185 with
// regs. Bounds rounded up. slice-diag.test.js evaluates the base commit's own
// push statement at the extremes against these.
const LINE_MAX = { plain: 48, regs: 192 };
const LINE_RE = {
  plain: /^\d{1,9} -?\d{1,10} [0-9a-f]{1,4}:[0-9a-f]{1,8}$/,
  regs: /^\d{1,9} -?\d{1,10} [0-9a-f]{1,4}:[0-9a-f]{1,8} (?:-?[0-9a-f]{1,8},){14}[0-9a-f]{1,8}$/,
};
module.exports = { LINE_MAX, LINE_RE };
