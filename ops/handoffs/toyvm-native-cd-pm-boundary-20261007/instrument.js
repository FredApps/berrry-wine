'use strict';
// Private diagnostic only. Record the operand the existing MOV CR3 handler
// discards; do not implement CR3/paging or change any architectural state.
function once(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw Error('exact source anchor absent/ambiguous');
  return source.replace(needle, replacement);
}
function instrument(source) {
  source = once(source,
    "  h('mov_cr_r', 1, `\n  ${ops(1)}\n",
    "  h('mov_cr_r', 1, `\n  ${ops(1)}\n" +
    '  (if (i32.eq (i32.and (i32.shr_u (local.get $t0) (i32.const 4)) (i32.const 7)) (i32.const 3))\n' +
    '    (then\n' +
    '      (global.set $diag_cr3_last (call $rget32 (i32.and (local.get $t0) (i32.const 7))))\n' +
    '      (global.set $diag_cr3_count (i32.add (global.get $diag_cr3_count) (i32.const 1)))))\n');
  source = once(source, '(global $cr0 (mut i32) (i32.const 0x0010))',
    '(global $cr0 (mut i32) (i32.const 0x0010))\n(global $diag_cr3_last (mut i32) (i32.const 0))\n(global $diag_cr3_count (mut i32) (i32.const 0))');
  source = once(source, '(func (export "get_cr0") (result i32) (global.get $cr0))',
    '(func (export "get_cr0") (result i32) (global.get $cr0))\n' +
    '(func (export "diag_get_cr3_last") (result i32) (global.get $diag_cr3_last))\n' +
    '(func (export "diag_get_cr3_count") (result i32) (global.get $diag_cr3_count))');
  return source;
}
module.exports = { instrument };
