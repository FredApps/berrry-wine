# AoE2 DirectPlay4 Unicode interface: repair proposal

The current startup failure is an intentional rejection of an unsupported Unicode interface, not evidence of a file-version reporting bug. Do not accept IID530 by returning the ANSI table. A bounded, real Unicode interface is feasible, but requires distinct interface identity handling and string-aware methods. No production changes, compile or guest runtime performed for this proposal.

## Identity and failing branch

No local dplay.h was found under /home/user, /usr or /opt. The authoritative [Wine dplay.h](https://raw.githubusercontent.com/wine-mirror/wine/master/include/dplay.h) defines IID_IDirectPlay4 as {0AB1C530-4745-11D1-A7A1-0000F803ABFC}; its A sibling uses531. Its DPNAME unions distinguish wide and ANSI string pointers. Source header bytes/hash/source URL are pinned in `scratch/aoe2-directx-startup-20261003/repair-analysis/header-source.json`; this was a source-only lookup.

The unchanged EXE at IID VA0x622108 contains exactly the16 bytes captured by the owning Worker. Saved bounded objdump output and EXE hash are in `repair-analysis/binary-proof.json` and `disassembly-*.txt`.

- 0x464f8e DirectPlayCreate returns to0x464f93; actual S_OK continues.
- 0x464fb0 pushes IID VA0x622108; QI at0x464fb6 returns to0x464fb8.
- 0x464fb8 tests EAX. Actual0x80004002 takes0x464fbc, zeroes EAX and returns at0x464fc5. This bypasses the subsequent GetModuleHandle/file-version chain entirely.
- Caller0x41be70 calls this gate. Zero return stores error code0x14 at[ebx+0x60] at0x41be79 and jumps out of initialization. Later error UI passes that code through its resource formatter; the observed MessageBox caller0x47b2c5 shows exact DirectX6.1a error.
- Success would release the original interface at0x464fcd, perform version queries, then release the queried interface at0x46515a. The gate itself does not use any W string methods, but that is insufficient reason to expose a fake interface.

## Existing implementation constraints

`src/09a8-handlers-directx.wat:10816` explicitly restricts QI to ANSI families. Current4A upgrades the same primary pointer to53 slots; `tools/gen_dispatch.js:444` defines it as an extension of the47-slot DirectPlay3 table. Append-only API metadata, generated dispatcher and worker vtable registry must stay consistent.

`dp_clone_name` at10188 uses guest_strdup; `dp_get_name` at10578 uses byte strlen and one-byte terminators. Creation/setter methods and enumeration callbacks use that shared name representation. EnumConnections at11199 constructs an ANSI TCP/IP label. `src/09d4-dplay-net.wat` stores/wires byte strings; its Open copies at most31 bytes of the supplied session name. DirectPlay system messages can embed name pointers. These are incompatible with simply routing a W pointer through existing methods.

COM wrappers carry a shared DX slot at+4. `dx_get_wrapper_for_vtbl` can supply a separate interface pointer, but its exhausted-pool fallback currently mutates the primary vtable. A W path must fail allocation instead of taking that fallback. Current entity/message/network ownership is often keyed by raw `this`, not shared slot. Merely sharing a DX slot does not make A and W methods share ownership correctly. QI(IUnknown) currently returns its input object, so W needs explicit canonical identity.

## Proposed bounded implementation

1. Add an actual53-slot DirectPlay4 W table, with generated ABI and worker registry entries. Keep A pointer/table stable; cache a W wrapper for the same live DX slot. QI validates the entire GUID and output pointer before state changes. Both A/W return one canonical IUnknown pointer and share refcount. Reject wrapper exhaustion without mutation. Preserve unsupported unrelated Unicode/Lobby generations unless separately implemented.
2. Normalize the owner identity for every delegated W method, including message queues, group membership, Close, final Release and network ownership. Do not use a process-global W flag: callbacks/reentrant calls and simultaneous A/W pointers require encoding to belong to the interface/call frame.
3. Implement real W local entity names: creation, replacement and retrieval for players/groups; preserve UTF16 code units, including non-ASCII and surrogate pairs. Report buffer sizes in bytes, include two-byte terminators, publish nothing into undersized outputs, and preserve cross-span guest safety. Keep A access defined through the existing Windows ANSI conversion policy rather than truncating high bytes; maintain a lossless W backing form. The specific shared table layout must be designed/checked before code changes.
4. Implement W EnumConnections provider labels and W entity enumeration callbacks with guest UTF16 payloads whose lifetime lasts through callback return/reentrancy. Frame state must preserve which interface encoding was requested. Preserve early termination and nested enumeration cleanup.
5. For session/network/account/chat/settings operations without a reviewed conversion/wire contract, return the documented unsupported HRESULT and leave state/outputs consistent. Never delegate their UTF16 pointers into byte code or inherit silent-success placeholders. Opaque application message payloads remain opaque; DirectPlay-generated system messages containing names need W conversion or explicit unsupported scope. `method-matrix.json` enumerates53 slots for the implementation review.

This supports a meaningful local Unicode interface while explicitly excluding unimplemented network/settings semantics. It may unblock the observed presence/version gate, but ordinary gameplay must be rerun after accepted tests/build; no current gameplay claim follows from this proposal.

## Regression plan and prepared test

`repair-analysis/directplay4w-contract.test.js` is prepared, syntax-checked, **not executed**. It uses actual generated COM thunks in a private compiled WASM harness; it does not mock QI.

- `--expect-unsupported`: current exact IID530 must return E_NOINTERFACE, clear output, preserve table/refcount; null output returns E_POINTER. This is the negative baseline to run before repair.
- Default after repair: distinct stable A/W pointers, all53 ABI entries, repeated W QI identity, canonical IUnknown, cross A/W QI and balanced references, full-GUID rejection.
- Create/set/get a W player with 雪, é, Ω and a surrogate-pair character. Verify exact round-trip strings, byte-size accounting, two-byte terminators, no partial output on one-byte-short buffers, and output canaries.

Before acceptance additionally extend real-WASM tests for group names, simultaneous ANSI/W operations and ANSI preservation; cross-page UTF16 spans; repeated/bounded allocation failure without wrapper mutation; W EnumConnections and entity callbacks (early stop, nested/reentrant A/W calls and lifetime); shared owner queue/Close teardown; explicit unsupported W session/settings operations without ANSI mutation; CoCreateInstance IID530 and failure cleanup; thread registry restoration. Run existing ANSI DirectPlay QI/4/enumeration/send/queue/lobby regressions unchanged. No runtime/build is authorized by this document itself.
