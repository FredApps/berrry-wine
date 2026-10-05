# VB Surface7 persistent foreground state

Owning diagnostic50151 captured SetForeColor/API4010 at return439664, color00ffffff, E_NOTIMPL and ESP12 after the expected native BltFast drawing error had not stopped the guest. The bounded observer retained126 records with large disclosed gaps; this is positive failure evidence, not a complete API history.

Native DX7VB73544f69 stores raw COLORREF before CreatePen, then replaces and deletes the previous owned pen only after allocation succeeds. Constructor73543c3e establishes black foreground, solid style and width1. This increment follows that ordering, including E_INVALIDARG on allocation failure with requested color retained and the old pen still owned. It does not translate an OLE color or claim to implement other style/font methods.

A declared shared64KiB region holds eight bytes per DX slot: COLORREF and pen handle. This avoids transient DC state, which ReleaseDC retires. Final object free and slot initialization delete the owned pen and clear the sidecar. The allocator declaration and generated JavaScript mirror are included together; no raw address or reused padding was introduced.

Focused session57787 passed33 groups in5.161seconds, retaining prior27. The matched before module failed the actual SetForeColor assertion. New groups exercise actual COM slot54/ESP12, real16bpp native pen pixels across transient DCs, independent surfaces, real GDI-object exhaustion and native failure ordering, forged receiver rejection, shared-state visibility from an auxiliary instance, and final-release cleanup/fresh defaults. The native line consumer is a test-only helper; it is not a implemented VB drawing method or a gameplay claim. No concurrent setter race qualification is asserted.

All4089 API names/IDs remain unchanged. Existing durable test/test-vbdd-surface-blt.js remains in its automatic tier. Canonical f40 was unchanged. Production gates remain required. DrawText is still E_NOTIMPL; static guest code immediately after this setter calls slot18 with the counted UTF16 literal Preview. Its real raster/DC contract is the next source task, not a reason to claim the puzzle works now.
