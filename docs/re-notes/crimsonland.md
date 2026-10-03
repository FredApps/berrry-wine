# Crimsonland

Reflexive wrapper-free fixture: `test/binaries/candidates/reflexive-crimsonland/game/crimsonland.exe`.
SHA-256 `93cdcdc872c836e75122e3a1d41312c74761cf4736181d3541521e82f6cb2031`.

## DirectX startup detection

The original `DirectX8.1 or newer not detected` message is at guest string
`0x474ec0`, used by the startup path around `0x42c700`. Version detection
`0x41cf90` tries COM DxDiag (`0x41d090`) then SDK-style component file
version checks (`0x41d2c0`). Registry DirectX Version overrides do not affect
that fallback. `0x41de30` performs GetFileVersionInfoSizeA,
GetFileVersionInfoA, and VerQueryValueA("\\") and reads VS_FIXEDFILEINFO.

The static system-module list omitted d3d8.dll and d3d9.dll despite runtime
implementation of their exports. Therefore named version queries failed.
The fix appends their identities after the existing Glide identities (no
existing pseudo handles shift), recognizes their version resources, and
reports component generations 4.8.1.901 and 4.9.0.904. Legacy DirectPlay
remains 4.6.3.518. This fixes the actual API chain without changing guest
code or bypassing its detection. Extended `test-static-dx-version.js`
passes all 23 assertions using the compiled canonical artifact.

## Launch and rendering

Seed `grim.dll`, `vorbis.dll`, `vorbisfile.dll`, `ogg.dll`; include the whole
asset tree. DLL DllMain calls return success. The launcher Play button is
control ID 1000 (normal mouse around312,134). Default screen mode is
800x600x32. Startup now reaches this real launcher and its D3D8 adapter.

The first asset load spends time in grim.dll JPEG decoding: relocated
`0x6215b2` is original `0x100425b2`, YCbCr-to-RGB table conversion.
`grim.dll` base in the observed run was0x5df000, original0x10000000.
Do not interpret an early black frame as a stopped guest.

A software CLI run ended by explicit quit after369batches/276seconds;
154759ms was spent waiting on just four software D3D requests, so software
rendering is impractical for this capture on the loaded local machine.
Native CLI reported that a GPU window was required. Browser GPU acceptance
is being pursued separately. No gameplay claim from these startup probes.

Browser verification on localhost58114 reached the renderer launcher and loading
artwork with two guest Workers; gameplay was not verified in the bounded run.
Latest capture: `/private/tmp/reflexive-probe/crimson-browser-live.png`.
