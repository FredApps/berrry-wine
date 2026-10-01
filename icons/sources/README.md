# Icon sources

Icons for apps whose executable carries no icon resource. The registry names
one with `iconFile`, and `tools/extract-app-icons.js` renders it into
`icons/apps/<id>.png` through the same decoder it uses for an RT_ICON.

| File | App | Origin | License |
|---|---|---|---|
| `quake2.ico` | `quake2_demo` | id Software's Quake II source release, [`win32/q2.ico`](https://github.com/id-Software/Quake-2/blob/372afde46e7defc9dd2d719a1732b8ace1fa096e/win32/q2.ico) at commit `372afde4`, unmodified (SHA-256 `1dfdadcc3ef3c7e1e2f58001f54cca201001ad419c98ce21b3fe875990f381a9`). It is the icon retail `quake2.exe` was built with (`win32/q2.rc`: `IDI_ICON1 ICON "q2.ico"`); the demo's executable shipped without a resource section. | GPL v2, as released by id Software. Source: <https://github.com/id-Software/Quake-2> |
| `nfs2.ico` | `nfs2_demo`, `nfs2se_glide_demo` | Generated for this project: 32x32 RetroDiffusion pixel art (`mc_item` style, prompt "yellow sports race car three quarter view windows 98 desktop icon", `remove_bg=true`, `seed=11`), wrapped with `tools/png-to-ico.js`. Neither demo executable (`nfsw.exe`, `NFS2SEA.EXE`) has a resource section with an icon in it. | Ours; not EA artwork. |

The Quake II emblem is drawn in teal (0,128,128), the Windows 98 desktop
colour, with a silver and grey bevel. On our teal desktop only the bevel
stands out. That is how id drew it, and it was kept that way on purpose.
