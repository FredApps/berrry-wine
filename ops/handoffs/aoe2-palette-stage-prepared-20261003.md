# AoE2 narrow palette-stage diagnostic ready

Private helper: `scratch/aoe2-palette-stage-20261003/browser.js`.
Validation: `validation.json` and `preparation-receipt.json` in that directory. Five pureJS suites pass (actual cleanup path, source injection, launch/served guards, API pairing, palette observer). Earlier canonical no-compile proof passed in40ms before Zuma's hold:23 selected trace return-landings and6 actual palette-branch outcomes. Missing live callbacks remain unknown.

Pins: browser387c54f52bfd3782a0968decea91174ca5f1c84abca44c10b1753af113d30ea6; palette observere00bbbc983d7e41900b51dabe75b6148ce1ae0880336e8683e23582ef7fd11fa; private Worker34e51ca165c11690e943e55697ef5bbc0c2c02aec8e8958a964f55cb18cb4808. Canonical modulef40 unchanged; current Worker3665f7c9 and all125 production sources pinned.21 helper files copied exclusively per attempt. Re-run `prepare.js` if production JS changes, then revalidate/review pins before launching.

The passive observer follows cache entry until actual hit/full/miss. Hit/full routes go directly to stage return; a miss follows the palette loader. It captures exact resource50500 return/size/ownership and at most32 bytes, parser checkpoints, GDI CreatePalette header/first3 entries and return, then loader/stage/parent result. Guest bytes translate individually, supporting sparse pages.64 events maximum; errors disable owned trace, export/import replacement fails validity while preserving foreign state. No guest writes or overrides, no FPS, no repeated mode census.

Cleanup attempts observer close, served validation, evidence writes, browser.close, server connections/close independently. Actual driver cleanup tests inject observer/validation/log/receipt/close faults; closure remains attempted and original errors retained. Source preflight requires explicit slot flag, TTY, registered AoE2, fresh output and exact source/helper pins; actual served production/private Worker hashes are checked on closure. Declared dependencies are rehashed at launch.

Proposed command (browser slot not yet granted):

```sh
DISPLAY=:0 node scratch/aoe2-palette-stage-20261003/browser.js aoe2 scratch/aoe2-palette-stage-20261003/attempt1 --slot-granted
```

Run in interactive TTY.120sec maximum; ordinary EULA Accept after personal review, stop at exact error or next menu. Snapshot commands and quit use the existing JSON stdin helper. No gameplay classification without actual terrain/units.
