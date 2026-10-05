# JigSawedME valid puzzle-image route

2026-10-03 corpus_categories. Offline exact-binary/source/index review only. No fixture generated, archive read/extraction, runtime, tests, build or production changes. Zuma helper unchanged.

The repaired ordinary run `scratch/runs/20261003-jigssawme-gameplay-repaired-jig/` reached main window and File Open without startup E_FAIL. Selecting the directory `C:\windows` produced `ShellExecute C:\i_view32.exe` with `/convert=C:\WholeImageTemp.bmp`. This is an invalid image selection and does not establish that a valid image needs the converter or fails to load.

## Exact executable evidence

Same JigSawedME.exe SHA1f795d46508782dc733603a8affc2fdc336dc5b6e971e248c67c11cfa6fb17ff, preferred/runtime base400000. The UTF16 string `.BMP` is at40a86c. At42dda3 it is compared through imported **__vbaStrCmp** (IAT4010d8) to the extracted extension. Equality takes42ddb2: copies the selected input path via **__vbaStrCopy** into global43b0b4, then **jumps directly to42e570**, past the converter construction/call. Therefore BMP conversion is **not unconditional**.

The non-BMP branch also tests .JPG/.GIF and has separate handling; this task does not require claiming those paths work. The external converter path uses `\i_view32.exe` at40a8a4 and ` /convert=` at40a8c4, constructing the call around42e2d0..42e302. The direct BMP branch reaches the shared loader at42e5a6, passing43b0b4 to a COM/vtable method. Thus an ordinary BMP still exercises the game's real file/graphics loading path; it does not bypass game initialization.

At42e7ab the code sets minimum dimension **0x80=128**, compares both returned dimensions signed-greater-or-equal at42e7b2/42e7b9, and proceeds at42e960 only when both pass. Otherwise it builds “Image must be at least ... pixels.” Exact small branch/minimum disassemblies are saved under `scratch/jigssawme-puzzle-input-20261003/`.

## Existing indexed assets

Read only the existing index `scratch/migration-fixture-staging-20261003/archive-members.txt`; did not open the archive. Case-insensitive `i_view32|irfan` search has zero matches. JigSawedME package matches only directory, EXE, EXE.manifest, LDMinMax6.ocx and piecelock.wav; no BMP/JPG/GIF/PNG puzzle image. This establishes absence from this indexed test-binaries archive/package, not every historical archive or the internet. Registered runtime closure remains EXE/OCX/WAV; no fixture blocker should be invented for the direct BMP route.

## Smallest proposed ordinary input fixture

Generate **128×128, 24bpp BI_RGB BMP**, bottom-up rows,40-byte BITMAPINFOHEADER,54-byte pixel offset,384-byte row stride,49206 total bytes. This is the exact minimum accepted dimensions and avoids palette/compression/alpha variability. Use a deterministic asymmetric test pattern with four distinguishable colored regions, a diagonal and differently colored corner blocks so a shuffled piece/ordinary move can be visually verified. Filename **JIGTEST.BMP**, explicit guest path **C:\JIGTEST.BMP**, contains no spaces and has the tested extension.

Create it later with a small JavaScript generator only after authorization, storing generator/version, dimensions/header fields, byte count and SHA256 in a **custom test-input receipt**. Add the file through the existing launch/VFS file-mount path using a private fixture manifest/launch clone; preserve the production app registry and original three-file closure. Record it as a custom input image, never as an original bundled game asset. No guest memory writes, direct COM invocation, fake loader output or generated puzzle board.

Future ordinary route: launch repaired app; use File→Open; type the full valid BMP path into the visible filename edit and activate visible Open. Do not select a directory row. Review actual loaded full image, puzzle/shuffle controls and resulting piece layout before making one ordinary piece move. Capture before/after and exact normal inputs. If an error occurs, preserve its dialog/API result; do not silently switch to converter or fake success. A source-proved direct BMP branch is a sound route proposal, **not proof that image load/gameplay will succeed**. FPS remains null.
