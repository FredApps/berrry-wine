# Analog mouse joystick (Blobby Volley / DX-Ball)

Local implementation, 2026-09-10; not deployed to production.

Both desktop registry entries use `touchControls.mouseJoystick` on the left
and mouse button 0 on the right (Jump / Launch). The joystick sends mouse
motion, not arrow keys. Both axes remain available for menu navigation;
gameplay predominantly uses horizontal motion. Direct canvas touch remains
available. Blobby keeps its shipped player-2 mouse scheme.

The fixed 112px circular pad has a radial 15% dead zone. Outside it,
speed is `maxSpeed * ((tilt - .15) / .85)^responseExponent` guest pixels/second,
with both profiles using `maxSpeed: 900, responseExponent: 3`, capped at full
deflection. Fractional movement is accumulated, diagonals are normalized,
and elapsed frame time is capped at 32ms to avoid a catch-up jump. Speed does
not depend on browser refresh rate or Fit/Fill presentation scaling.

Phone precision follow-up: exponent raised from 1.7 to 3, reducing half-tilt
speed from about 199 to 63 guest px/s while preserving 900 at full tilt.
Quarter tilt is about 1.5 px/s, accumulated fractionally rather than rounded
away each frame. The profile can tune speed and exponent independently.
The stick integrates velocity into a guest cursor position and supplies its
delta alongside it; this is not a mapping from stick position directly to
paddle position. Absolute-position games use that cursor; relative-input
games can interpret deltas with their own sensitivity. These two profiles
remain cursor-oriented; this change does not introduce an FPS-look mode.

Only a held, deflected stick schedules animation frames. Center, release,
cancel, blur, resize, hidden document, layout replacement and teardown stop
movement. One touch owns the stick; a second touch can hold Jump/Launch.
Coordinates are converted from the current native guest cursor through the
existing inverse presentation mapping before normal mouse event delivery.

Fit uses the shared board-area geometry: 148px landscape side rails, or a
200px portrait bottom control band, respecting safe areas and keyboard freeze.
Phone spacing follow-up: joystick/action bottom clearance is 36px plus the
bottom safe area (formerly 18px). Portrait controls follow the actual game
bottom with a 24px gap when space allows, rather than hugging the phone bottom.
The primary Jump/Launch button aligns with the joystick top; Fit/keyboard
sit 18px BELOW the primary action. The group is clamped above the safe bottom
when space is tight. Landscape retains the outward 8px side placement and
also puts the primary action above its utility pills.
Fill retains full-screen coverage and translucent overlays. No extra fullscreen-close control
is introduced.

Regression coverage: `test/test-touch-controls.js` (speed response, dead zone,
mapping, ownership, simultaneous click and release/cancel/teardown),
`test/test-single-app-keep-aspect.js` (native-surface Fit rails / portrait band
and unchanged Fill). A local Chrome touch probe at390x844 and844x390 exercised
both real apps; before the precision follow-up, half deflection moved roughly54 guest pixels per250ms versus
roughly245 at full deflection. Phone speed/precision and extended gameplay
remain manual acceptance checks. A second probe entered a Blobby match and
a DX-Ball level via the right action button, repeated the steering/action
checks in both orientations, and captured visible gameplay without page
errors. This is Chrome touch injection, not a real iPhone acceptance pass.

Follow-up: canvas touch is explicitly `direct` for both profiles, independent
of software-cursor/relative-mouse heuristics. The DOM bridge publishes mouse
position at touch-down and before a tap/drag/right-click button event; Blobby
menus hit-test their cached WM_MOUSEMOVE position (see test-blobby-volley.js),
so button coordinates alone are insufficient. Empty overlay areas remain
pointer-transparent.

Mouse-joystick profiles send left-button down at touch-start and up at lift
or cancel, just like a physical mouse. A deferred instantaneous down/up at
touch-end was missed by Blobby's frame-based button polling even after the
cursor position was corrected. These two profiles therefore do not turn a
stationary canvas hold into right-click; ordinary app tap/long-press behavior
is unchanged. A100ms direct touch on the visible Start label in the800x600
browser menu started a match before any joystick or Jump interaction.

On the live iPhone without `viewport-fit=cover`, Safari supplied a712px-wide
landscape viewport and the controls added its50px side inset a second time:
joystick x68..180 overlapped game x148..564. Mouse-joystick landscape corner
padding is now8px within that already-safe viewport. Explicit cover viewports
retain their notch insets; portrait layout is unchanged.
# Pointer lock policy

Browser mouse input defaults to absolute coordinates. `relativeMouse: true`
explicitly opts a game into pointer lock and relative deltas; Quake II,
Half-Life Uplink and Deus Ex carry that declaration. `ShowCursor` and
`ClipCursor` do not imply relative input, and cursor visibility is mirrored
independently. Diablo variants use direct touch and retain absolute input.
There is no cursor-state capture latch. Other games needing relative input
must declare it after their input path is confirmed.
