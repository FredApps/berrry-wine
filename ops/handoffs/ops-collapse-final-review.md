# Final Collapse qualification integration review

Owner `codex:01a0f9db-89c0-73b3-b528-fe8bf239e061`, 2026-10-02. Read-only review of final preparation handoff, bound `tools/qualify-collapse.js`, `collapse-qualification.js`, accepted GDI observer and frozen supporting host/renderer/server code. No runtime/network/build/fixture mutation. Root independently owns identity/closure verification and serialized host allocation.

**No static blocker found for one explicitly granted qualification-only diagnostic.** This accepts the bounded diagnostic design, not a successful game launch, player control, counter qualification or performance result. Preserve the external620s owner-only ceiling and wait for Ricochet's resource release before remote use.

## Ownership, bounds and cleanup

The driver uses a fresh output directory, verifies pinned inputs/links and module before importing browser dependencies, starts a fresh loopback ephemeral server, and launches its own Puppeteer browser without a stale-browser sweep. Cleanup closes only that browser and server, with fallback targeting the owned browser process and owned server connections. No reference service, shared profile or foreign PID is used. Startup and post-await admission use the prior reviewed owned-resource helper; late handles are disposed rather than accepted.

Body deadline600s races the route. Browser acquisition requires40s remaining and uses30s startup/protocol bounds. Finally salvages raw observer buffers for at most3s, closes owned browser within10s and server within5s. Root's external620s ceiling remains useful for unexpected process-level stalls; this code review does not prove live cleanup behavior. Failure preserves the original report/error and does not retry. `phaseGate` excludes measurement; no performance-publication transition exists.

## Registry and geometry

`registerApp` validates the exact four-field private descriptor and refuses a conflicting existing registration. Frozen index.html1906 takes a reference to `window.wineApps.APPS`; mutating this same object in page setup therefore reaches the ordinary launcher. Registration does not alter frozen apps.js or substitute host/runtime files. Normal trusted Launch remains the actual entry point. Readiness checks require isolation, active visible Worker backend and later route-specific imagery.

`pageMetadata` correctly reads own-memory canonical surface metadata through `wine.hostCtx.sharedGdi.surfacePresentations`; `hostCtx.renderer` is the frozen getter at host.js1213. Runtime state adds cached window `clientRect`. Frozen renderer.js511 assigns absolute guest screen coordinates; fallback529 adds window origin. Thus the driver uses observed `{x,y,w,h}` to crop the actual800×600 client, not window outer dimensions or invented guest addresses. It rejects exclusive presentation and nonunique/nonmatching top-level windows. Metadata reads do not invoke a surface flush or WAT accessor.

Historical click offsets32,44 remain only as conversion from the preserved desktop coordinates to client-relative115,233 and88,66. Actual page coordinates and screenshots use the observed client origin and screen canvas scale. If those historical button/board locations no longer match the observed game, the route can fail or produce no score response; that is a qualification result, not permission for fallback click grids. Reference crops are pinned historical image crops, separate from the live crop.

## Observer coverage and diagnostic interpretation

The actual Worker source is overlaid before instantiation; original/served/helper hashes are retained. Guest worker creation/destruction is observed before launch. Active guest contexts without observers, evaluation errors, contexts starting or retiring around the window, changed arm/stop context sets, and before/after metadata changes are explicitly recorded. The accepted observer retains source-clock event windows, caps/drop status, raw lifecycle and requested rectangle distributions; contexts are not timestamp-merged.

The driver deliberately passes `reviewed:false` to association diagnostics and leaves `counterQualified:false`, `measurementEnabled:false`, `performance:null`. Consequently candidate distributions cannot silently certify the selected surface. Root must inspect coverageAmbiguities, buffer/clock failures, actual board images and surface metadata even if the overall status is `qualification-candidate-awaiting-visual-review`. That status is not PASS for complete coverage.

The short observation includes a click, wait and screenshot/crop. Screenshots can force host presentation/readback and alter timing; these raw timestamps are **diagnostic only**, not clean FPS samples. Endpoint metadata equality neither proves lifecycle continuity nor atomic state; the retained raw events and coverage gaps must guide interpretation. A full requested upload may still be clipped/unchanged and optimistic RPC success is not display completion. None of these limitations blocks collecting the bounded diagnostic.

## Route and renderer limits

Three consecutive template candidates reduce accidental menu/board matches; retry imagery explicitly rejects a common false route. The helper does not claim template equality proves numerical score, cleared blocks or player control. Human review remains required after the preserved two-click route. Capture/state failures preserve screenshots or failure reasons where possible and end the route; no automatic expansion or measurement occurs.

Actual browser/CDP GPU and launch flags are saved before guest launch. Explicit SwiftShader mode is disclosed. Browser-GPU identity alone does not establish guest GPU rasterization; this game is expected to use GDI. Hardware classification remains context-verification-pending rather than a completed hardware baseline. No new performance claim is supported by this preparation.

Final recommendation: accept for the one serialized, owner-guarded qualification after root's identity/closure checks. Review terminal outcome, all coverage/error fields, input response and cleanup before assigning any next step. No new change request or runtime permission is issued by this handoff.
