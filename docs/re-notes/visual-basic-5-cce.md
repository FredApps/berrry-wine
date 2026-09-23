# Visual Basic 5.0 Control Creation Edition (and the other free VB/Delphi editions)

Status 2026-09-22: **VB5 CCE installs, opens the IDE in design mode, and runs a
shipped sample (F5).** VB6 Working Model and Delphi 6/7 Personal are blocked on
licensing (see the end).

## Source

- `archive.org/download/vb5ccein/vb5ccein.exe`: the free 1997 CCE installer,
  7.48 MB. It is a self-extracting cabinet around an ACME-style `setup.exe`
  driven by SetupAPI INFs. Downloaded into `downloads/`, which is not committed.
- The installer needs a SetupAPI. Win95 has none, so the run mounts the one
  DirectX 7 redistributes: `test/binaries/candidates/deus-ex-demo/DirectX7/SetupAPI.dll`.
  Copy it next to the exe and pass `--vfs-include='setupapi.dll'`.

## Reproduction

Install with `--winver=nt4`, persisting C:\ and the registry. On the 9x
version, setup takes a different path that we have not driven.

```sh
node test/run.js --no-build --winver=nt4 --exe=$DIR/vb5ccein.exe --vfs-include='setupapi.dll' \
  --quiet-api --max-batches=120000 --max-seconds=500 --stuck-after=1000000 \
  --input=10:dlg-cmd:6,200:dlg-cmd:6,35000:dlg-post-cmd:1,37000:dlg-cmd:6,100000:dlg-cmd:1 \
  --no-close --overlay-dir=$OV/c --reg-export=$OV/reg.json
```

The inputs answer, in order:
1. the two extractor Yes/No questions;
2. the "Directory" OK. It appears around batch 29,600. It **must** be `dlg-post-cmd`: its handler opens a nested MessageBox, and a synchronous `dlg-cmd` abandons that after 64 rounds;
3. "create directory?" Yes;
4. the final "installation complete".

Installed files land under `c:\program files\vb5cce` and `c:\windows\system`, and the OCXs self-register into the registry.

Run the IDE on a sample and press F5, then ">>" and OK:

```sh
node test/run.js --no-build --exe="$OV/c/program files/vb5cce/vb5cce.exe" \
  --exe-guest-path='c:\program files\vb5cce\vb5cce.exe' --cwd='c:\program files\vb5cce' \
  --args='"c:\program files\vb5cce\samples\axlstpik\testgrp.vbg"' \
  --overlay-dir=$OV/c --overlay-flush-ms=0 --reg-import=$OV/reg.json --quiet-api \
  --max-batches=60000 --stuck-after=1000000 \
  --input=30000:keydown:116,30010:keyup:116,45000:mousedown:470:283,45020:mouseup:470:283,50000:dlg-cmd:1 \
  --no-close --png=out.png
```

Expected results:
- The title reads "Project1 - Microsoft Visual Basic [run]".
- Form1 shows the AXListPicker UserControl.
- ">>" raises `MsgBox "Moving 5 items to the Destination!"`.
- After OK, all five items are in Destination.

`--exe` has to be a host path; `vfs5/` in the session was the overlay's blobs copied out under their guest names.

## What it needed (all covered by `test/test-vb5-setup-com-apis.js` unless noted)

- **`lstrcmp`/`lstrcmpi` use CompareString's word sort, not a byte compare.** SetupAPI keeps INF strings in a table sorted with `lstrcmpi` and binary-searches it. With byte order, `CommonFilesDir` was never found, and setup failed in the directory-ID phase. Ties are broken by case (lowercase first); the skipped `-`/`'` decide last, with the string that has them sorting after ("coop" < "co-op").
- **DeleteFileA/W and SetFileAttributesA/W set the last error on failure.** On a missing file that is 2, otherwise 5. Setup deletes a temp file that does not exist and then checks `GetLastError() != ERROR_FILE_NOT_FOUND`. The stale 8 left behind by an earlier call produced a "Delete Error" box.
- **CLSIDFromString is strict.** It takes a 38-character braced GUID or a ProgID looked up in `HKCR\<progid>\CLSID`, and returns CO_E_CLASSSTRING otherwise. The IDE passes it `"VB.PropertyPage"` from a `.pag` file. The old lenient parser "succeeded" on it with garbage, so the page failed to load.
- **IIDFromString, and OleSetMenuDescriptor(NULL, ...).** OleSetMenuDescriptor's non-NULL (install) form still crashes as unimplemented.
- ImageList_* additions, `%#x` in wsprintf, DS_SETFONT dialog templates, CreateMDIWindowA, CreateItemMoniker and IsTextUnicode (earlier in the same session).
- **The button→parent notification is a guest tail call** (`$ctrl_notify_parent` / `$ctrl_dispatch_with_tail` in `09c3a-dialog-runtime.wat`). Clicking ">>" delivers BN_CLICKED to a VB form whose handler opens MsgBox, which is a modal loop. Sent through `$wnd_send_message`'s nested `$run`, that loop was abandoned after 64 rounds and the click did nothing. When a BUTTON is entered through CallWindowProcA or DispatchMessageA and the parent is an x86 wndproc, the WM_COMMAND is now queued as the guest's continuation of that call, so the handler runs on the real guest stack and can pump messages. No unit test covers this yet; the VB5 route above is the coverage.

## Known gaps

- **A plain launch with no project argument** shows a bare Open dialog instead of the New Project tabbed dialog. The IDE uses an OFN hook plus a custom template, and we do not support that combination.
- **The IDE chrome:** toolbar button images, and the project-explorer labels (tree items draw their expand boxes but no text).
- **`msi.dll`'s `Invoke` loop** runs MsgWaitForMultipleObjects with a real handle array (`host_wait_multiple`). The CCE setup does not need it, but the VB6 path touched it.

## VB6 Working Model / Delphi 6 & 7 Personal

- **VB6 Working Model** (`archive.org/.../visual-basic-6-working-model-edition`): setup requires the Product ID printed on the CD sleeve. The archive's scan does not contain it, and we do not fabricate keys, so it is blocked here.
- **Delphi 6 Personal and Delphi 7 Personal** (magazine cover-CD ISOs): setup requires a serial and authorization key that Borland issued per registration. Blocked for the same reason.
