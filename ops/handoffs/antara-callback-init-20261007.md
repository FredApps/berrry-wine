# Antara original callback and resource outcome, 2026-10-07

Task: `NEW-GAME-BETRAYAL-ANTARA-DEMO-20261006`. This is an intermediate causal checkpoint, not a gameplay qualification or implemented fix.

The ordinary original SETUP launch uses source `096889e174488a97529b8e73076d3a1e2feb2345` and module SHA-256 `fb1be916c309bf619a9331c8fd46c4319f9051af76b05b236d3c362bb632638f`. The original recovered `_SETUP.EXE` SHA-256 is `a11e70704b15c12424e771a1b7c331396f69644d7cb1f53a7a5b3999f9309bb4`. No guest byte, callback return, API outcome, artificial control or input was changed. A private Worker and receipt-only WorkerLink observed the actual owning child.

## Measured callback path

Original caller NE segment 2:313a passes dialog procedure 2:2ca0. The actual USER87 `dialog_loaded` import arms before initialization, with child tid 2, HWND 98306 / Win16 HWND `0117`, parent 98305, procedure `0047:2ca0`, segment base `170000` and limit 55093. The original procedure receives `WM_INITDIALOG` (`0110`), wParam/lParam zero, resolves object `0087:655a`, and dispatches vtable slot `+70h` to actual `004f:d530`. The callback then installs ordinary subclass `0047:12f2` via USER136. That adapter's ordinary dispatch slot `+58h` enters actual `0047:1c2e` for window-position and move messages.

All 86 captured callback blocks and four virtual entries match original code with relocation operands authenticated. The scalar stream contains 100 complete frames / 1060 values with no unknown marker, partial frame or observer error. The capture ends at the 512-hook-arrival bound before WM_PAINT; no paint dispatch observation is claimed. The original zero-item dialog resource remains insufficient evidence for missing controls.

## Measured resource failure

KERNEL60 `FindResource`, hInstance `0110`, type 2, far name `0057:317c` resolving id 164, returns resource handle `0118`. KERNEL61 `LoadResource` with that handle/instance returns AX zero at EIP `1a3ef6`. KERNEL62 `LockResource(0)` returns DX:AX `0000:0000`; GDI442 `CreateDIBitmap` receives null bitmap data and returns zero.

Original recovered `SOL_ENG.DLL` SHA-256 `22f02bb8ee3adbe997b87bff3409492effb35baa0453d39e78104002cf33a375` has bitmap 164 at file offset 101216, length 308272, bitmap SHA-256 `0b04090ffa3c9c4decd15a3ffe55afde3e0509786eb198b8a63014b24d5afc6b`. Its 40-byte header specifies 640x480 / 8 bpp. These original bytes exist, but their runtime file-open/read or allocation cause has not been observed.

Source `win16_res_load` reopens dynamic modules to read resources because only their 64 KiB metadata image is retained. `win16_res_module_path` synthesizes `C:\NAME.DLL`, whereas `VfsSeed.residentWin16Module` can stage a module from another VFS directory and returns its actual path. Host staging currently discards that path. This is a hypothesis requiring the next actual LoadResource import observation, not a proven fix. Copying from the metadata image would be invalid for this bitmap.

## Durable evidence and cleanup

`scratch/runs/20261007T222523Z-antara-callback-init/artifact-index.json` was published last and indexes 570 hashed contained artifacts (~90 MB), including full 509-pin runtime closure, exact module/source/original 23 media files, recovered original EXE, helper scripts, logs, contexts and four screenshots. `analysis.json` records measured outcomes and limits. The personally reviewed `evidence/callback-settled.png` is the empty gray 640x480 Main Menu; there were no inputs, installation completion, game launch, gameplay, FPS or audio claims.

Remote box `bx_d8nw3e8t`: driver PID 108732 / Chrome PID 108744 launched 22:25:23 UTC, cleanup finished 22:26:22.851 with browser/server closed, zero cleanup errors, zero pending streams and Chrome exit 0. Independent terminal verification at 22:28:32 found both PIDs absent, no Chrome or owned sockets. After durable publication, owned remote prefix was removed and the lease released at 22:29:17. No local browser or native build ran.

Next prepared source-only diagnostic (`scratch/antara-resource-outcomes-20261007`) observes bounded actual resource file paths/results/read counts and activates callback block tracing only after a validated full WM_PAINT delivery frame. Pure JS observer, framing and real private Worker init/slice/stop-RPC integration checks pass. Its runtime execution awaits the explicit remote slot grant; no production fix or regression acceptance is claimed yet.
