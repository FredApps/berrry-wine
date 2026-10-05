# DirectInput live mouse buttons — 2026-10-05

Based on main a15d5e467bea6f856560b1534eb833a9b34af702. DirectInput GetDeviceState and GetDeviceData's physical-button fallback now use a dedicated get_mouse_buttons_live import. It reads the renderer's existing physical left/right state. Message snapshots, GetKeyState and OLE drag semantics remain unchanged. Existing renderer/input handlers implement two buttons; this change does not add middle/X button support.

A queued mouse snapshot could override a currently held button, or retain a released button. The real-WAT regression fails on the before source at the new current-button assertion and passes on the candidate, covering stale up/down and both held buttons while preserving the message snapshot. Full production build including shake, existing renderer mouse-mask test and CLI DirectInput control test passed. Private module SHA256: 2e2fd8d1ca62cd87f0bc09312bc4836108df610d00cb7771bb5ae22755eceedc.

Validation completed 2026-10-05T17:46:48.049Z; all child processes exited in 23.18 seconds. Local receipt: scratch/new-game-morrowind-20261005/live-buttons-main-a15d5e46/validation.json. This is a semantic repair, not a Morrowind gameplay qualification: attempt8 returned 62 zero-button states during an ordinary held click, but did not capture the live renderer mask/active snapshot. A bounded host census on the ordinary route remains needed to establish that run's cause.

DirectInput immediate state contract: https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee417897(v=vs.85)
