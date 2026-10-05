# Icon sources

Icons for apps whose executable carries no icon resource. The registry names
one with `iconFile`, and `tools/extract-app-icons.js` renders it into
`icons/apps/<id>.png` through the same decoder it uses for an RT_ICON.

| File | App | Origin | License |
|---|---|---|---|
| `quake2.ico` | `quake2_demo` | id Software's Quake II source release, [`win32/q2.ico`](https://github.com/id-Software/Quake-2/blob/372afde46e7defc9dd2d719a1732b8ace1fa096e/win32/q2.ico) at commit `372afde4`, unmodified (SHA-256 `1dfdadcc3ef3c7e1e2f58001f54cca201001ad419c98ce21b3fe875990f381a9`). It is the icon retail `quake2.exe` was built with (`win32/q2.rc`: `IDI_ICON1 ICON "q2.ico"`); the demo's executable shipped without a resource section. | GPL v2, as released by id Software. Source: <https://github.com/id-Software/Quake-2> |
| `nfs2.ico` | `nfs2_demo` | `NFS2.ICO` from the root of the original 1997 Need for Speed II PC CD-ROM ([archive.org `nfs-2_202308`](https://archive.org/details/nfs-2_202308), `NFS2.ISO`), unmodified (SHA-256 `20de34b6c9f6baddc687cd426dd5b1a0eb6e9c8691ca9370d5a3d5c6808ec6a5`). It sits beside `NFSW.EXE`, the same executable the demo runs; neither carries an icon resource. | © Electronic Arts, as shipped on the retail CD. |
| `nfs2sea.ico` | `nfs2se_glide_demo` | `NFS2SEA.ICO` from the root of the Need for Speed II SE CD-ROM ([archive.org `need-for-speed-ii-se`](https://archive.org/details/need-for-speed-ii-se)), unmodified (SHA-256 `ef37a51b1d99ef3fc0194351c9bb8ab57abd9d4a020451e32395b29cd56cedb2`). EA's icon for `NFS2SEA.EXE`, the 3Dfx executable the SE demo runs. | © Electronic Arts, as shipped on the retail CD. |

The Quake II emblem is drawn in teal (0,128,128), the Windows 98 desktop
colour, with a silver and grey bevel. On our teal desktop only the bevel
stands out. That is how id drew it, and it was kept that way on purpose.
