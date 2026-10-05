# Refined AoE2 graphics diagnostic prepared

Preparation/plan and separate metadata proposal: `scratch/aoe2-graphics-refined-20261003`. No runtime or canonical edits.

The next private observer records the actual graphics initializer return at source-proven caller0x41d76d and subsequent parent stage branches using the existing exported EIP tracing control/import. This changes diagnostic flags only; it does not overwrite guest memory/registers or API outcomes. Callback entry is authenticated against the actual EnumDisplayModes callback/context arguments; bounded descriptor/caps fields are captured. Relevant Blt/lock/clipper/palette calls extend the prior selected filter. Caps/drops/unresolved callbacks remain explicit.

PureJS tests cover forwarding receiver/return/throw, actual owner PC, callback identity, wrapped/unmapped/sparse pointers, unresolved-output rejection, phase changes, record caps and disabling/restoring cleanup. Four test files passed before the MH2 measurement hold. Production source remains frozen. Root review is required before the next120-second ordinary EULA-to-error diagnostic.

CreatePalette/CreateClipper nargs are separately proven one short by actual guest stack cleanup and source signatures; standalone DirectDrawCreateClipper is correct and excluded. This does not prove the graphics failure cause. No metadata correction has been applied.

## Root review corrections

Graphics errors now disable tracing on the exact exports captured at first arm and prevent rearm. An exports swap never causes a disable call on the foreign instance. A replaced log_eip import is preserved but explicitly marks the diagnostic failed; validate-observers.js consumes failure and cleanup records. Tests cover these rejection paths. Pending callback entries are bounded by the parent observer limit24 for EnumDisplayModes.

The granted tiny canonical proof completed in27ms without compilation: actual f40 log_eip delivery at ten return-landing PCs and six conditional branch outcomes in unchanged EMPIRES2.EXE. These isolated CPU fixtures establish hook delivery and actual instruction branching; a missing callback in the live route remains unknown. Four pureJavaScript test files pass. Updated browser/privateWorker/helper hashes are in preparation-receipt.json. No refined browser run yet.
