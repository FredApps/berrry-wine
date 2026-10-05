# DirectDraw7 table completeness candidate

Source-only candidate atop current-main private52c86d8c, preserving laptop CRT and Hype changes. Original source/control snapshot remains b8176c43. No gameplay qualification or passing corrected runtime test is claimed.

Native DX7VB vtable735236f0 has34slots. Existing factory had30. Slots30–33 are now callable with native argument counts. Slot31 TestCooperativeLevel delegates to the existing native predicate, stores its HRESULT in statusOut, returns COM S_OK and advances ESP12. Native oracle7354220f..73542224 proves this split. Sparse/unmapped outputs are validated. The actual primary COM_WRAPPERS address, live refcount and type33 authenticate this; a caller-fabricated pair cannot name slot0. Slots30 SetDisplayMode,32 WaitForVerticalBlank and33 GetDeviceIdentifier remain explicit E_NOTIMPL with exact ABI and unchanged outputs. No mode change, wait or identifier is fabricated.

Existing4089 API names/IDs remain fixed; four appended IDs4089–4092. Existing23 unsupported methods now consume their typelib argument counts; supported0–29 handlers are unchanged. Factory allocates one34-entry dynamic vtable without another shared region or registry slot.

First focused session98674 stopped after5.955sec: before correctly failed missing callable31; candidate passed5groups then failed fake-object identity. That failure, module and exact original source/test/runner are immutable in scratch/new-games-pipeline-20261004/jigssawme/directdraw34-repair-20261005/attempt1. The correction retains and strengthens the assertion with a copy of a valid wrapper pair; no expectations weakened.

Durable test/test-vbdd-directdraw34.js covers11groups: callable factory/full table and IDs, native result split, adjacent allocations/repetition, invalid outputs, forged identities, sparse status write, unsupported tail ABI, all prior unsupported method pop sizes, second factory and live/stale refcount. Existing test/test-vbdd-surface-blt.js supplies42 earlier contracts. Automatic test-name tier applies. Corrected53groups, production gates on current-main source, and ordinary BMP Open still required before publishing implementation.
