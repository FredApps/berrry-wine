# DDE room frame validation

2026-09-22: the receiver now validates its private `DDE1` frame before any
allocation, callback enqueue or pending/conversation update.

Previously it checked only the 28-byte header minimum. It trusted the declared
payload length, scanned names beyond the received extent, and loaded a four-byte
ACK even when fewer bytes arrived. A truncated POKE name could therefore make
the payload subtraction underflow and copy stale receive-buffer bytes into a
512-byte DDE data slot.

The shared validator checks the Wasm address/count without overflow, magic,
supported type, payload length against both actual received bytes and the
256-byte protocol capacity, and the minimum ACK size. String-bearing frames
require a NUL inside the declared payload; CONNECT requires two terminated
names. Names must fit the existing 128-byte scanner's interpretation, while
EXECUTE commands can use the whole payload. Binary DATA is not string-scanned.
Bytes after the declared payload are ignored, not treated as terminators.

`test/test-win16-dde-frame-validation.js` initially demonstrated 13 state-mutating
malformed inputs. Its final matrix has 18 rejected cases, with direct validator
assertions plus a snapshot of the DDE tables around delivery. It also tests
out-of-memory-range addresses/counts without a Wasm trap, valid full-size EXECUTE,
empty DATA, complete ACK, empty service/topic CONNECT, and a valid POKE that
actually queues. This is not a drop-all guard.

This validates the emulator's own transport, not a native Windows wire protocol.
Peer authentication, transaction identity/handle validity, callback/string
ownership, large-payload transport and allocation-failure behavior remain
separate work. It is not a general proof of DDE parser or guest-pointer safety.
