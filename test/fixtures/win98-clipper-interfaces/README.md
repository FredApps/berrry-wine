# Native clipper interface observations — 2026-09-22

Captured on Windows 98 4.10 under v86 using Microsoft's DDRAW.DLL and the
corpus DX7VB.DLL (4.08.01.0881). No Wine source was used. The latter DLL is a
DirectX 8.1-distributed implementation of the DirectX 7 VB API; these findings
do not establish every historical DX7VB build's behavior.

```sh
node tools/v86-reference/capture.js --online \
  --manifest tools/v86-reference/clipper-apps.json --app clipper-interfaces \
  --output /private/tmp/wa-clipper-native.png \
  --metadata /private/tmp/wa-clipper-native.json \
  --serial-output /private/tmp/wa-clipper-native.serial.txt
```

`serial.txt` and `repeat-serial.txt` retain two fresh VM runs with normalized
LF endings. Capture metadata records the VM sources and payload hashes;
`probeSourceSha256` additionally pins the final probe source. Executables,
OS images and screenshots are not committed. The fixture integrity test checks
the observations and six deliberately corrupted variants; it is not a test
of the emulator's runtime implementation.

## Findings that change the fix

- Native clipper QI accepts IUnknown and IDirectDrawClipper with the same
  pointer. Releasing each query result returns 1; final Release returns 0.
  A forged tail and the VB clipper IID fail with E_NOINTERFACE and clear output.
- DX7VB's `DirectDrawClipper` IID is
  `{9F76FDCA-8E92-11D1-8808-00C04FC2C602}`. Its type kind is interface,
  not dispatch. The vtable has **11** slots (44 bytes), not our current 10.
- Slots 3–10 are InternalSetObject, InternalGetObject, GetClipListSize,
  GetClipList, SetClipList, GetHWnd, SetHWnd, IsClipListChanged. Parameters and
  byte offsets are preserved in the serial output. Our native/VB shared QI
  cannot return the VB pointer for a native IID: their method layouts differ.
- The extended FUNCDESC probe reports tail return VT_HRESULT (25), parameter
  VT_PTR (26) to VT_INT (22), flags FOUT|FRETVAL (0x0a). On this 32-bit ABI
  that is a four-byte `int*`, not the two-byte VT_BOOL/VARIANT_BOOL type.
  Microsoft's [VARENUM definitions](https://learn.microsoft.com/en-us/windows/win32/api/wtypes/ne-wtypes-varenum)
  distinguish these types. The retained captures were both rerun with this
  extension; their executable and source hashes match the updated probe.
- The actual VB class factory and DirectX7 root creation succeed. Its
  DirectDrawCreate with an empty BSTR returns E_FAIL in this VM, so **no VB
  clipper object QI behavior was observed**. Do not convert that failure into
  a successful VB lifetime claim. Further native investigation remains open.

Metadata is obtained with Microsoft's
[LoadTypeLib](https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-loadtypelib)
and [ITypeInfo::GetTypeAttr](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nf-oaidl-itypeinfo-gettypeattr),
not by assuming typelib binary offsets. The absolute DLL path avoids implicit
type-library registration. A first draft's substring match also selected
Direct3DRMClippedVisual; a second draft used lstrcmpW, which did not distinguish
names in this Win98 VM. Neither draft's observations are used here: the final
probe compares the exact UTF-16 name locally.

## Runtime work still required

Native/VB interface identities and successful-query ownership were fixed in
`b856290d`. The follow-up tail fix allocates eleven slots and shares native
IsClipListChanged's compatible thunk; specialized destruction is unchanged.
See [runtime review](../../../docs/directdraw-clipper-query-interface-review.md).
Native NULL-pointer fault behavior, VB object QI and concurrent reference
updates have not been measured. Other VB clipper methods remain incomplete.
