'use strict';

// WIP building block for 80386 paging; NOT connected to guest memory access.
// Intel 80386 PRM (1986), 5.2, 6.4/table 6-5, 9.8.14.
//
// Return an i64 tagged result. Low 32 bits hold the physical address on
// success, the faulting LINEAR address for #PF, or the unavailable physical
// address for a backing miss. High 32 bits hold status | (PF error << 8).
// A caller must check status before accessing memory. Physical zero is valid.
// Missing host backing is not an architectural not-present page.
//
// No TLB yet. CR3 reload/instruction-cache invalidation belongs to integration.
// A20 is explicit: the old linmask conflates RAM size with address-bus width.
// Paging must never use that capacity mask on its input or output.
const STATUS = Object.freeze({ ok: 0, notPresent: 1, protection: 2, backing: 3 });

function helpers(isa) {
  return `
(func $page_result (param $address i32) (param $status i32) (param $error i32) (result i64)
  (i64.or (i64.extend_i32_u (local.get $address))
    (i64.shl (i64.extend_i32_u
      (i32.or (local.get $status) (i32.shl (local.get $error) (i32.const 8))))
      (i64.const 32))))

;; A20 gates one physical address line; it does not truncate to RAM capacity.
(func $page_bus (param $address i32) (param $a20 i32) (result i32)
  (select (local.get $address)
    (i32.and (local.get $address) (i32.const 0xffefffff)) (local.get $a20)))

;; Paging structures currently require ordinary physical RAM. Device-backed
;; page tables need a physical bus accessor before they can be supported.
(func $page_table_ram (param $p i32) (result i32)
  (i32.and (i32.le_u (local.get $p) (i32.const ${isa.GUEST_RAM_SIZE - 4}))
    (i32.or (i32.lt_u (local.get $p) (i32.const 0xa0000))
      (i32.ge_u (local.get $p) (i32.const 0xc0000)))))

(func $page_translate (param $directory i32) (param $linear i32)
  (param $write i32) (param $user i32) (param $a20 i32) (result i64)
  (local $dp i32) (local $tp i32) (local $de i32) (local $te i32)
  (local $p i32) (local $error i32)
  (local.set $write (i32.ne (local.get $write) (i32.const 0)))
  (local.set $user (i32.ne (local.get $user) (i32.const 0)))
  (local.set $error (i32.or
    (i32.shl (i32.ne (local.get $write) (i32.const 0)) (i32.const 1))
    (i32.shl (i32.ne (local.get $user) (i32.const 0)) (i32.const 2))))
  (local.set $dp (call $page_bus
    (i32.add (i32.and (local.get $directory) (i32.const 0xfffff000))
      (i32.shl (i32.shr_u (local.get $linear) (i32.const 22)) (i32.const 2)))
    (local.get $a20)))
  (if (i32.eqz (call $page_table_ram (local.get $dp))) (then
    (return (call $page_result (local.get $dp) (i32.const ${STATUS.backing}) (i32.const 0)))))
  (local.set $de (i32.load (local.get $dp)))
  (if (i32.eqz (i32.and (local.get $de) (i32.const 1))) (then
    (return (call $page_result (local.get $linear) (i32.const ${STATUS.notPresent}) (local.get $error)))))
  (local.set $tp (call $page_bus
    (i32.add (i32.and (local.get $de) (i32.const 0xfffff000))
      (i32.and (i32.shr_u (local.get $linear) (i32.const 10)) (i32.const 0xffc)))
    (local.get $a20)))
  (if (i32.eqz (call $page_table_ram (local.get $tp))) (then
    (return (call $page_result (local.get $tp) (i32.const ${STATUS.backing}) (i32.const 0)))))
  (local.set $te (i32.load (local.get $tp)))
  (if (i32.eqz (i32.and (local.get $te) (i32.const 1))) (then
    (return (call $page_result (local.get $linear) (i32.const ${STATUS.notPresent}) (local.get $error)))))
  ;; 386 supervisor writes ignore R/W (there is no 486 CR0.WP contract here).
  ;; User access requires U/S at BOTH levels, and a write requires both R/W.
  (if (i32.and (local.get $user)
    (i32.or (i32.eqz (i32.and (i32.and (local.get $de) (local.get $te)) (i32.const 4)))
      (i32.and (local.get $write)
        (i32.eqz (i32.and (i32.and (local.get $de) (local.get $te)) (i32.const 2)))))) (then
    (return (call $page_result (local.get $linear) (i32.const ${STATUS.protection})
      (i32.or (local.get $error) (i32.const 1))))))
  (local.set $p (call $page_bus
    (i32.or (i32.and (local.get $te) (i32.const 0xfffff000))
      (i32.and (local.get $linear) (i32.const 0xfff))) (local.get $a20)))
  (if (i32.ge_u (local.get $p) (i32.const ${isa.GUEST_RAM_SIZE})) (then
    (return (call $page_result (local.get $p) (i32.const ${STATUS.backing}) (i32.const 0)))))
  ;; Only successful translations promise A/D updates. The PRM does not define
  ;; their precise state for failed translations; never clear software bits.
  ;; Snapshot both entries before either write: recursive directories can make
  ;; dp == tp. OR the dirty update last so it cannot be overwritten.
  (i32.store (local.get $dp) (i32.or (local.get $de) (i32.const 0x20)))
  (i32.store (local.get $tp) (i32.or (local.get $te)
    (select (i32.const 0x60) (i32.const 0x20) (local.get $write))))
  (call $page_result (local.get $p) (i32.const ${STATUS.ok}) (i32.const 0)))
`;
}

function unpack(result) {
  const tag = Number(result >> 32n) >>> 0;
  return { status: tag & 255, error: tag >>> 8, address: Number(result & 0xffffffffn) };
}

module.exports = { STATUS, helpers, unpack };
