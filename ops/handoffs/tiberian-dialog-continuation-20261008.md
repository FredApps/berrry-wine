# Generic dialog continuation and return semantics

Isolated /home/user/wt-darkstone-refill-20261007, branch
findings/tiberian-return-semantics-20261008 from a180c8c94. Previous branch
preserved; coordinator reviews, integrates and pushes explicit paths only.
This revision depends on a180c8c94's CallWindowProc frame contraction.
That candidate was held because delegated DefDlgProc returned raw DLGPROC
BOOL for command/application/client messages.

Retained negative controls:
- Original ac8c4c8ff: actual x86 subclass → CallWindowProc(native dialog) →
  stored DLGPROC → real nested DialogBox resumes the subclass before modal
  closure. Original source/test/failure log plus prior candidate source
  closure are copied into the new evidence folder. Overlay the saved control
  window-late fragment on that closure to reproduce the original baseline;
  published original evidence is unchanged.
- a180c8c94: actual x86 subclass/caller sends WM_COMMAND0x111; the stored
  DLGPROC calls SetWindowLongA(DWL_MSGRESULT,77), returns TRUE, and the caller
  receives 1 instead of 77. Both A/W fail. Saved candidate regression omits
  only new continuation-lifecycle assertions unavailable in candidate source.

DefDlgProc now pushes a separate guest callback frame beneath its retained
four-argument API frame. DLGPROC returns to CACA003C; this continuation reads
the invocation's original HWND/message/arguments and EAX BOOL, calls the
shared dialog result/default epilog, then resumes the original caller with
exact stack cleanup. CallWindowProc's five-to-four argument contraction
remains. No live invocation state uses shared globals; the global stores only
the continuation address. PE loading reinitializes that address and Worker
thunk synchronization restores it.

The common result helper retains BOOL exceptions (including WM_INITDIALOG),
DWL_MSGRESULT for other handled messages, and existing FALSE default handling
including modal IDOK. This repairs exported DefDlgProc's existing shortcut
and native-dialog CallWindowProc, with no game offsets or forced returns.

Final actual x86 A/W regressions:
- WM_COMMAND0x111/application0x400: DLGPROC writes77 and returns TRUE →77;
  FALSE →0; absent DLGPROC →0; caller resumption and exact ESP.
- WM_INITDIALOG BOOL1 and WM_ERASEBKGND DWL_MSGRESULT77, actual callers plus
  retained synchronous checks.
- Nested SendMessage through another subclass/native dialog: inner TRUE88
  or FALSE0, outer TRUE77, exact outer stack restoration.
- Real nested modal suspension/EndDialog99 completion, with another WASM
  thread running TRUE88 while main is parked. Main returns77 to its original
  caller with exact ESP; the other thread does not alter its stack.
- PE continuation initialization and main/Worker thunk restoration.

Custom dispatch expectations now check retained API and live callback frames.
Custom dispatch, handled IDOK, null-DLGPROC erase, EndDialog lifecycle and
Worker thunk synchronization regressions pass. Full canonical build passes all
gates and both modules compile. Source-part documentation reflects the new
continuation/epilog. No test tier or region layout change is required.

Self-contained evidence:
`/home/user/wine-assembly/scratch/runs/20261008-tiberian-return-semantics`.
Both negatives, candidate/final source/tests, A/W logs, five related regression
logs, full build log, source/build closure, modules, patch and SHA index.
Artifacts inspected before result.json is published last. Existing fixture
symlink/shared NODE_PATH used; fixture deletions excluded from commit.

No browser, remote, original SUN.EXE or performance run. Generic defect proven;
actual game cause and original stored DLGPROC entry/return/selector write
unmeasured; gameplay false. Next phase needs coordinator review/integration
and separate game runtime authorization.
