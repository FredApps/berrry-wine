# Win16 EXECUTE command transport

2026-09-22. Microsoft's [XTYP_EXECUTE contract](https://learn.microsoft.com/en-us/windows/win32/dataxchg/xtyp-execute)
places the command string in `hdata`, the topic in `hsz1`, and leaves `hsz2`
unused. This is official DDEML documentation, not a native Win98/Win16 capture.

The previous sender saved `pData`/`cbData` only for POKE and emitted an item
name for EXECUTE. The receiver interned the command as an HSZ and passed zero
as `hdata`. The new runtime regression reproduced all three failures in both
synchronous and asynchronous calls: lost command bytes, wrong HSZ argument,
and missing data handle.

The fix preserves EXECUTE's byte pointer/count in both pending-record paths,
sends command bytes without an item-name prefix, and gives the receiving
callback an owned command-data handle with unused `hsz2` zero. It uses the same
enqueue rejection and callback cleanup as the other incoming data transactions.
ADVSTART remains allocation-free. Existing POKE/ADVDATA behavior is retained.

`test/test-win16-dde-execute.js` constructs the real Win16 Pascal API frame and
calls `win16_DdeClientTransaction`, captures its emitted wire bytes, and passes
those bytes to the real receive path. Its 128-byte command exceeds the 67-byte
HSZ text limit; both timeout modes preserve it exactly, including the NUL.
It also verifies the 28-byte argument cleanup, caller sentinel, callback data
and reclamation. Callback invocation itself remains covered by the separate
real-task DDE tests, not by this direct-helper regression.

## Limits still open

- The wire payload remains capped at 256 bytes. Larger EXECUTE commands now
  return failure with DMLERR_LOW_MEMORY rather than executing a truncated
  prefix. This is an emulator capacity limit, not a claim about native capacity
  or native error selection. The regression covers 257 and `0xffffffff` counts.
- `cbData = -1` (data-handle input) remains unsupported and takes that explicit
  capacity failure. Supporting it and longer commands needs separate work.
- Native Win98/Win16 callback values/lifetime, CBF_FAIL_EXECUTES, CBR_BLOCK,
  malformed input, retries and asynchronous buffer ownership are not certified
  by this test. Existing callback cleanup policy was not redesigned here.

The change is a tested correction to the supported inline-command path, not a
claim of complete DDEML conformance.
