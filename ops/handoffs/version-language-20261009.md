# Version-resource language descriptions

Dungeon Siege's original demo passed the resource enumeration fixes and then
trapped at its `KERNEL32.VerLanguageNameA` import (EIP `0x617fcc`, IAT `0x6f521c`,
language `0x0409`). The original startup evidence is in
`scratch/runs/20261009T0003Z-dungeon-siege-verlanguage`.

Added ANSI and Unicode handlers with a shared Win98-era English description
lookup, unknown-language fallback, bounded copying and character counts excluding
the terminating NUL. API IDs are appended; dispatch and hash tables regenerated.
This follows the [documented API contract](https://learn.microsoft.com/en-us/windows/win32/api/winver/nf-winver-verlanguagenamea)
and [historical language identifiers](https://learn.microsoft.com/en-us/previous-versions/commerce-server/ee785500(v=cs.20)).
It does not implement modern NLS or change the existing Win16 adapter.

The interned string pool needs 5564 bytes with these descriptions. Its declared
allocation grows from 4096 to 5632 bytes and the generated JS region map follows.
An initial 8192-byte allocation failed the placement-shake gate; the final
allocation passes every layout mode without reducing any other region.

`scratch/runs/20261009T0105Z-version-language` contains the exact source pins,
module, earlier failing checks and final passing checks. The canonical build
passed in v4. The final v5 tests pass: `test-wat-version-language.js`,
`test-locale-info-wat.js`, and `test-file-version-info.js`. The new regression
resolves both real API hash entries through dispatch and checks multilingual
descriptions, unknown IDs, full/exact/short/zero buffers, ANSI/UTF-16 bounds,
unsigned capacity and stdcall ESP restoration. Detached process60004 exited0.

Original-game browser validation remains a separate step. These API tests do
not qualify Dungeon Siege gameplay, FPS or audio. Tests ran on the separate
no-env box `bx_jnfsbbvz`; no public deployment.
