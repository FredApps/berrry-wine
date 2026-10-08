# Crimsonland: normal main-thread exit after Enter

Run `scratch/runs/20261008T0048Z-crimsonland-owning-exit-runtime` completes the
authorized owning exit diagnostic. Reference source `f62ab3c9f`, module
`4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`, original
EXE `93cdcdc872c836e75122e3a1d41312c74761cf4736181d3541521e82f6cb2031`.
The only guest runtime overlay is the reviewed passive Worker observer,
SHA `afcdd42f91068fbbb25e14b822b1e7782d52566887b50876fd6836306f9a5877`.
No production behavior, trace flag, guest state, return or breakpoint changed.

## Actual route

The corrected `?app=crimsonland&debug&d3d9-renderer=webgl` route reached the
original launcher. Reviewed Play at322,295 held750ms reached the actual main
menu directly. Both the host endpoint and owning render Worker reported
neutral/WebGL. This advances the Oct8 retained publisher-splash result; the
toolbar still displays Notepad but the loaded executable and route are
Crimsonland. No outside-driver navigation, viewport or launcher correction.

Reviewed PLAY GAME at218,450 held750ms did not open the submenu. The game cursor
appeared near670,302 and stayed there across subsequent ordinary moves, while
GPU writeSeq advanced2092→3073→4664→7919. Read-only host geometry showed
Pointer Lock active, canvas684x536 at10,194, native800x600 with destination
684x513 at0,11. Renderer virtual cursor242,285 differs from the game-drawn cursor.
Synthetic Escape750ms left Pointer Lock active; a real desktop `xdotool key
Escape` released it. These are browser input observations, not evidence of a
specific guest or engine defect. Ordinary Enter750ms then preceded exit to the
desktop. Tutorial, movement, FPS and audio were not qualified.

## Owning exit and original-code authentication

At00:55:02.692Z the owning import recorded one ExitProcess(0), current thread
ID1 (main), ESP074fff68, EBP074ffff8, EIP454df2, return454e02. The observer
reported zero fault triples,512 bytes read, no errors and no expiry. Absence of
a triple alone cannot exclude a suppressed/unreported exception, but the
captured caller identifies this exit path independently.

Both96byte spans at454df2 and454de2 match the pinned original EXE exactly.
The captured stack contains454d4a and454f6f; EBP-60 contains zero. Original
disassembly establishes:

1. CRT startup454f61 calls WinMain42c700.
2. 454f66 saves returned EAX atEBP-60;454f6a passes it to normal exit454d3d.
3. 454d45 calls cleanup454d5f, leaving return454d4a.
4. 454dfc calls ExitProcess through IAT46f104, leaving return454e02.

This is normal CRT cleanup following WinMain returning zero. The historical
worker-thread exception body454808→454d4e, its454d5b return, and scope46f838
are not the captured path. The October4 DirectSound Lock `w2g` repair is already
in this exact reference source. Neither another DSLock patch nor a speculative
SEH/REP fix is supported by this run.

## Generic input diagnosis and next discriminating work

The reviewed source `lib/browser-input.js` forwards locked mouse motion using
DOM movementX/Y and routes locked button events through the renderer virtual
cursor. The harness uses absolute `page.mouse.move(x,y)`. Therefore a screenshot
coordinate and a successful mouse command do not prove that the game-drawn
DirectInput cursor reached that target. No actual DOM movementX/Y or owning
DirectInput sample was captured, so the exact cause of the cursor divergence
remains unmeasured.

Host keyboard rows for Escape/Enter name hwnd0. That is a pre-routing queue
observation: `inputEventHwnd` permits zero, and GetMessage substitutes
`main_hwnd` after `input_route_to_owner`. It does not prove that the final
message had hwnd0, reached a hidden launcher, or was delivered to the wrong
thread. Those are hypotheses requiring owning message/callback evidence.

Before any production fix, qualify ordinary relative pointer motion with
actual hover evidence and capture bounded original owning Get/PeekMessage,
DispatchMessage and relevant original callback entry/return for Enter. The
question is which application input/shutdown branch returns WinMain, not
which historical exception handler produced code0. Reproduce a demonstrated
generic contract failure before changing routing or DirectInput behavior.
Do not repeat the full launch blindly or force a guest return/focus/cursor.

## Cleanup and limits

Ordinary quit closed browser/server00:55:25.952Z, Chrome exit0, streams0.
Independent00:55:54 checks found driver41487/Chrome41509 absent, no Chrome,
baseline sockets and all530 pins unchanged. Captures were downloaded and SHA
checked before the owned remote prefix was removed. Shared boxbx_c9he3835
lifecycle and retained Puppeteer belong to the coordinator; remote slot was
released00:55:54. Four asset errors are retained (auth/user, app icon and
stdole2.tlb/part); no causal claim. This phase did not build or use a local
native slot. Screenshots show menu/startup only, not playability.
