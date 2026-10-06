# Aliens versus Predator: Marine demo (Rebellion, 1999)

`lib/apps.js` id **`avp_marine_demo`** (localhost-only), exe
`test/binaries/win98-games-a-d/Alien vs Predator-MarineDemo-D3D/AvP_Marine_Demo.exe`
with `SMACKW32.DLL`. Same engine as the Alien demo
([avp-alien-demo.md](avp-alien-demo.md)): DirectDraw + Direct3D execute
buffers, DirectInput keyboard plus buffered mouse; software rasterizer headless.

## Files

The directory is an installed tree sitting beside its InstallShield media.
`--trace-fs` over boot and the level load shows the game opens only
`AVPVMOPT.BIN`, `menglish.txt`, `avp_huds\*.rif`, `AVP_RIFS\invasion.RIF`,
`fastfile\*.FFL` + `mffinfo.txt` and `FMVs\*.smk`; it creates `LOGFILE.TXT`,
`dx_error.log` and `ConsoleLog.txt` itself. `tools/gen-win98-games-a-d-manifests.js`
excludes the installer, cabinets, those logs and the HTML `Marine Instructions\`
(32 companion files). The misses for `fmvs/alien.smk`, `final.smk`,
`hugtest.smk` and `tyrargo.smk` are movies this demo does not ship; it carries on.

## Route

```sh
node test/run.js --app=avp_marine_demo --quiet-api --batch-size=50000 --max-batches=4101 --no-close \
  --input='1800:keydown:13,1804:keyup:13,3900:tick-ms:10,3950:di-mousedown:1,4100:di-mouseup:1,3980:png:/tmp/fire.png'
```

Main menu (Start Marine Demo / Controls / Video Options / Exit Game) by
~1750; Enter loads the Invasion level (~2400 loading bar) into first person
in the hangar. Aliens attack within seconds of guest time: the screen
flashes red from the sides as health drops, as the readme describes. Fire is
mouse button 1 (`di-mousedown:1`): the pulse rifle's muzzle flash, the rounds
counter falling and acid-blood sprays on the aliens.

As in the Alien demo, walk and turn at `tick-ms:10`: at the default
200 ms/batch one frame is ~1 s of guest time, so a held key moves or turns
in huge steps, and the boot itself is long enough of guest time that the
aliens arrive before the first input.
