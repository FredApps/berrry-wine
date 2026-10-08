# Antara ordinary Install callback investigation

Task `NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006`; runtime phase completed with
one browser, one ordinary visible Install click, and no production change.
Fresh branch starts at coordinator `ac8c4c8ff`; previous branch preserved.
Shared HEAD/index untouched. No local build/native slot used.

Durable self-contained evidence:
`scratch/runs/20261008T004749Z-antara-callback-runtime` in the root checkout.
The accepted prepared archive is hardlinked, not edited or duplicated. Original
SETUP and recovered child are hardlinked; captured evidence is ordinary files.
`authenticate.js` reruns the offline original-code checks without guest execution.

## Actual outcome

Original Sierra artwork/Main Menu appeared. The reviewed Install point
`411,167` received ordinary mouse move/down, 150ms hold, and up. The menu,
immediate click scene and settled scene have identical image SHA
`1e570bfa818f1bc621a0396f1af8c6be0976e2f46a00c557ae5a15013614ac3b`.
Installation did not advance during this observation. No game launch or
controlled gameplay was reached.

The owning callback receipt records slot0 `check_input` DOWN packed `00010201`,
HWND `18002`, and lParam `00900198` / client `408,144`. Slot0 restores its trace
at the eight-second deadline: three rows, zero heavy memory bytes/errors,
12,876,320 trace words, no partial frame. It retains no modal-route/API row and
no UP row. Console separately records ordinary UP at 00:48:18.427 UTC; that
does not identify its polling Worker. Slot1 receipt never activates, has no
rows, and reports zero errors. Its receipt is the initial receipt: do not infer
that the child received no message from this absence.

The real-owner post-click sample shows main tid1 and auxiliary tid2. Auxiliary
is active, EIP `12ff40`, yield6, no critical-section waits. Its modal stack
contains HWND16 `0118`, return `004f:313f`. Original `_SETUP.EXE` segment2
code at this return authenticates byte-for-byte except documented original
NE relocation sites; call2:313a / operand313b is imported USER.87 DialogBox.
Main code also authenticates against original SETUP segment1. These are
asynchronous post-click code/frame snapshots, not historic input callback
entry/return evidence. They establish the original modal wait, not a cause.

## Concrete coverage finding

Frozen `f62ab3c9` source has `$input_route_to_owner` in GetMessage/PeekMessage.
A FIFO event polled by another thread is posted through `$post_queue_push_input`
to the creating thread and the poller's packed result becomes zero. The new
observer activates only when that Worker's **host check_input** returns DOWN.
Thus a forwarded DOWN can activate slot0 diagnostics while the modal owner
dequeues its message without calling host check_input for that DOWN. This
source-defined route is outside the activation coverage. The slot0 observation
is compatible with forwarding; actual enqueue/dequeue and child callback
entry/return are unmeasured. No input theft or missing-callback defect follows.

A next diagnostic must cover the actual owning queue/modal route independently
of which Worker wins the host FIFO poll, with bounded trace-only activation
across both existing Workers and original source authentication. Seal a
forwarded-input observer regression first. Do not repeat this check_input-only
trigger or infer a production fix from its empty child receipt. No further
browser or native/build action is authorized by this completed phase.

## Identities and cleanup

Runtime source `f62ab3c9f1223ab47cf623470f6343d508257878`; module
`4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`.
Accepted archive `8007a9b5a3f1fb05a9ef8b861994ffeb936fdd1542688e2241c591d878420031`.
Original SETUP SHA `51f3ea06024d54734eef19344a2b79b89db78e73b68fc951fb3643b04a921e1c`;
child SHA `a11e70704b15c12424e771a1b7c331396f69644d7cb1f53a7a5b3999f9309bb4`.
All 42 original media pins remain in the accepted archive/manifest.
Private Worker `b453ec4d`, WorkerLink `6f9bd8f5`, registration `cf2bc3c9`;
163 full served responses match original or explicit overlay pins, zero drift.
No current-main build qualification is claimed.

Transfer completed00:47:47 with all505 pins verified. Driver35564/Chrome35576
started00:47:49. Ordinary stop00:49:04.562 closed browser/server/recorder with
errors[], streams0, Chromeexit0. Independent00:49:30 checks found both PIDs
absent, no Chrome and exact baseline sockets. All505 pins rehashed before the
scoped prefix was removed00:49:40.603; Puppeteer retained. Actual REMOTE RELEASE
was appended00:49:40 for Crimsonland. Root owns bx_c9he3835 lifecycle/expiry
01:03:26.516. No worker jobs remain.
