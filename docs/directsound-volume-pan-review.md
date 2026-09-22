# DirectSound volume/pan state review — 2026-09-22

Implemented on main in `src/09a8-handlers-directx.wat`.

## Finding and change

`GetVolume` and `GetPan` always wrote zero. Their setters forwarded to an
existing browser voice only, so calls before the first Play silently vanished.
Play also duplicated the lazy voice-opening logic used by 3D QueryInterface
and primary SetFormat.

The existing zero-initialized, per-buffer auxiliary record now owns signed
centibel volume/pan at offsets 16/20. Getters read it, setters update it, and
the shared `dsbuf_ensure_voice` applies it before playback. Existing duplicate
record copying carries these settings to the duplicate; subsequent changes
remain independent. No new host imports or parallel JS getters were added.

Setters reject out-of-range values. Missing creation capabilities return
DSERR_CONTROLUNAVAIL; 3D buffers reject pan. Null getter outputs and wrong
object types return DSERR_INVALIDPARAM. Failure does not change the stored
setting or send a host update. Getters use guest-aware DWORD stores, including
when the output crosses non-contiguous sparse pages.

## Evidence

The new `test/test-directsound-volume-pan.js` exercises actual API dispatch,
DirectSoundCreate/CreateSoundBuffer/DuplicateSoundBuffer, getters/setters,
Play/Stop/Release, and stack guards. Before the fix it failed with volume
`0` instead of `-2400`. Coverage includes:

- initial values and settings before any host voice exists;
- host update order before first playback and separate duplicate voices;
- independently mutable duplicate controls and live updates;
- valid limits, invalid signed values, missing/individual capabilities;
- 3D volume versus unavailable pan, null output and wrong interface;
- sparse cross-page output, output sentinels and stdcall cleanup;
- stop/restart preservation and zero defaults after slot reuse.

This is API/state and host-boundary evidence, not an audible browser or native
Win98 conformance capture. Tests compile current source; no shared artifact
rebuild or release certification is implied.

The quiet-handler baseline remains **247 manual + 22 metadata**. The old
getters already contained `if`/output calls and therefore were outside this
straight-line classifier. No pin or classifier adjustment is justified.
Exact-duplicate membership drops from 499 to 497 (126 groups unchanged), since
the two former identical getters now delegate to distinct control selections.

Related runtime suites passed: DirectSound set-current-position, buffer-format,
buffer-query-interface, 3D-listener, 3D-web-audio and ring-queue. Fragment,
handler-ESP, generated epilogue, logical-AND, dispatch, hash-table, test-tier,
silent-handler and duplicate gates passed. These runs compiled the current
shared source successfully, without the GL source overlay required in the
preceding viewport-alias review.

## Official contracts consulted

- [GetVolume](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee418071(v=vs.85)) and
  [GetPan](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee418069(v=vs.85)):
  report centibel settings and expose invalid-parameter/unavailable-control errors.
- [SetVolume](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/mt708939(v=vs.85)) and
  [SetPan](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/mt708938(v=vs.85)):
  volume range -10000..0; pan range -10000..10000.
- [Buffer control options](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee416240(v=vs.85)):
  controls require their creation flags.
- [Playback controls](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee418742(v=vs.85)):
  3D buffers cannot be panned; primary volume affects the device output.
- [DuplicateSoundBuffer](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/mt708944(v=vs.85)):
  initial parameters are copied but remain independently adjustable.

These are Microsoft's archived DirectSound docs, not Wine source. Some pages
describe Buffer8; they do not establish Win98 error precedence when several
arguments are invalid simultaneously.

## Next candidates / known limits

1. Frequency state follow-up: implemented in
   [directsound-frequency-review.md](directsound-frequency-review.md), retaining
   a separate playback rate. Host cursor continuity across live rate changes
   remains a separate issue.
2. Host pan currently maps centibels linearly to StereoPanner [-1,1]. That is
   not DirectSound's one-channel attenuation law. Test actual channel gain,
   both browser and frozen/headless paths, before changing it.
3. Primary volume is not yet device-wide mixer volume; primary cooperative
   priority rules and shared-device state need native reference tests.
4. DuplicateSoundBuffer still copies PCM instead of sharing backing storage.
   This patch fixes parameter lifetime, not sample-storage lifetime or OOM.
5. Invalid non-null pointers, error precedence and broader descriptor/3D
   validation remain outside this test. The silent inventory is a lower bound,
   not a census of every incorrect success return.
