# Antara actual owning input callback

Source observer `f381764be`, isolated branch `findings/antara-owning-queue-20261008`,
coordinator base `f21fe79a6`. Previous branches and shared HEAD/index preserved;
root integrates explicit paths. No native/build slot used. Root reviewed/granted
at00:57:06. Self-contained run:
`scratch/runs/20261008T0059Z-antara-owning-queue-runtime`.

Accepted503-member archive is hardlinked unchanged with explicit Worker/Link
overlays and unchanged original SETUP/child hardlinks. Published preparation
`20261008T0101Z-antara-owning-queue-ready` remains immutable. Original source
`f62ab3c9`, WASM `4dc5ac2c`, archive `8007a9b5`; Worker `8018f609`, Link
`268a608e`, observer `86921bc5`. All505 remote pins verified before/after;
all163 full served responses match.

## Actual observation

One browser, one reviewed ordinary Install click `(411,167)`. Both actual
existing slots0/1 acknowledge the same token for DOWN and UP before those
ordinary actions. Ready/click/after/settled PNGs match SHA
`fad66b10fb7a27c9f05bc024a1470fe26918767e6c3dab9e794823082534a618`.
Installation and gameplay do not advance.

Slot0 polls DOWN `00010201`, HWND `18002`, client lParam `00900198`
(`408,144`). It records3rows/no heavy reads,58222 DOWN and65536 UP words;
UP word cap restores tracing and retains its partial frame. Processing counter
total46.17ms/error0. This bounds the prior12.8-million-word poller stream.

Child slot1/tid2 records **28rows/415words/4160heavy bytes/error0**, restores
at its eight-second deadline, and retains modal NCHITTEST `0084`, DOWN `0201`
and UP `0202` routes to HWND `18002`. DOWN/UP client points are `(408,144)`;
queue count is zero at each route. The child has **no host DOWN poll**, covering
the prior forwarding gap. It host-polls UP. Processing counter total1.475ms;
no partial frame or flag-restoration error.

`authenticate.js` verifies **all ten actual child API caller spans** against
original `_SETUP.EXE` NE segment2, with differences only at original relocation
sites. KERNEL.55 Catch returns to `004f:1131`; USER.122 CallWindowProc returns
to `004f:17f6`. CallWindowProc receives prior procedure `001f:ff20`, HWND16
`0117`, actual messages/client point; DOWN/UP API answers are DX:AX zero,
NCHITTEST one. These are original guest API calls and handler answers, not
complete guest callback RETF receipts. Post-click original modal return
`004f:313f` also authenticates.

## Cause narrowed; no speculative repair

Frozen `win16_CallWindowProc` recognizes the prior pointer as the built-in
thunk and reaches default processing. That alone does not justify a dialog
forwarding repair: original dialog procedure `2:2ca0` statically accepts only
WM_INITDIALOG/WM_SETFONT and immediately returns zero for DOWN/UP. Merely
adding that DLGPROC call cannot explain Install.

Actual DOWN CallWindowProc frame contains object `008f:655a` and saved returns
`004f:122f` and `005f:24e8`. Original `2:122b` dispatches virtual slot+5ch
to the default wrapper. Static original **segment4** candidate `4:24e3`
calls `2:120a`, returning at `4:24e8`, after checking object+1c6h/+1e6h
and selecting menu actions. The collector did not retain selector005f's
descriptor/code, those fields, preceding mousemove or action-selection branch.
Segment4 correspondence is a static candidate, not an authenticated runtime
segment mapping or proof of a failed gate. Next measure original object
hit-test/action state and message-map handling, including preceding mousemove.
No missing-delivery claim, forced command, game offset or production change.

## Cleanup

Transfer completed01:00:37; driver25778/Chrome25800 started01:00:46.
Ordinary stop01:01:35.968 closed browser/server/recorder, errors/streams0,
Chromeexit0. Independent checks: actual PIDs absent/noChrome/exactfreshbaseline
sockets/505unchangedpins/about50GBfree. Owned prefix removed01:02:22.918,
within90-second reserve; actual soleREMOTE RELEASE posted01:02:22.

Fresh noenv boat `bx_43wuxzx3`, expiry01:28:12, and Puppeteer tools
`/home/user/antara-tools-20261008/node_modules` retained. Queued Crimsonland
explicitly adopted lifecycle01:02:58; do not delete during its ownership.
This worker has no browser/remote/build jobs remaining.
