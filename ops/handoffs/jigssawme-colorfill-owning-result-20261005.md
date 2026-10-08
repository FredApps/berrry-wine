# JigSawedME ColorFill route and next completed failure

Private source d7ae7321b96eb36d448278fa100ec1ac544c175d; production-shaped WASM 08e3e3332ba556d963146b48094ce79c1632a930154858a7050f52ec173d55be (1,666,778 bytes). Root full production gates and 17 actual-COM contracts passed; this is not gameplay qualification.

Ordinary attempt1/session70127 timed out during operator context recovery before upload, not a guest failure. Unchanged ordinary attempt2/session12788 completed Upload, Cancel/reopen, JIGTEST.BMP selection and Open. Personally reviewed image-open.png shows “Unable to Open the specified Image File”; startup normal. Browser/server closed12:30:11.107Z, exit0, no cleanup errors.

A bounded owning-Worker observer then ran the same route in session22710. It retained42 selected API records, no errors/drops, and restored all three original imports. Actual image Blt caller428e37 completed COM_S_OK/drawingStatus0. Six ColorFill calls at429436,42946d,41a0ae,41a0e3,41a118,41a14d completed COM_S_OK/drawingStatus0 with ESP+20; this positively establishes progress past the previous ColorFill failure.

First selected failure is record39: IVBImageSurface7_SetColorKey/API4003, caller0x41a207, args [this0x080090d0, flags8, keyPointer0x00a59e74], completed E_NOTIMPL0x80004001, ESP+16. Prior CreateSurface record36 establishes this as a2x2,16bpp surface. The key contents were not decoded. Do not infer subsequent API behavior. The visible image error remains; no puzzle/gameplay/FPS claim.

Diagnostic cleanup12:34:28.682Z, exit0, browser/server closed, errors[], process check clear. Evidence: scratch/new-games-pipeline-20261004/jigssawme/surface-blt-repair-20261005/corrected/color-fill/drawing-error/attempt1/result.json and validation.json (41 SHA-256-pinned artifacts); ordinary evidence scratch/new-games-pipeline-20261004/jigssawme/surface-blt-repair-20261005/corrected/color-fill/ordinary-browser/attempt2/validation.json. Observer source7bfd0e56c25783fd7e9b3dc489b7c3cad6fe41f5ea3033d453c58b1f66ac0d89; private Worker77b4d814e6d68469ef07301411bd80b4cd3c8d290391640f9b4700541a766bde.

Next: inspect native DX7VB SetColorKey slot47 ABI/return semantics and actual native surface color-key behavior; only then prepare a narrow real before/candidate contract. Candidate remains private pending ordinary image/puzzle progress.
