# Corpus restoration report

Updated: 2026-10-04T11:26:56.259Z

Local extracted corpus rsync completed. Follow-up restored 72 NFS II SE build assets and replaced the Mac-only Morrowind ISO symlink with actual bytes.

- declared-route-present: 218
- no-registered-route: 18
- missing-files: 5

Remaining missing paths: 156

- Snood: 3 declared paths.
- Baldur's Gate non-interactive demo: 8 declared paths.
- Baldur's Gate interactive demo: 89 declared paths.
- Baldur's Gate Chapters I & II: 55 declared paths.
- winamp_mod: 1 declared paths.

The three Baldur’s Gate demo directories are self-referential symlinks locally; the retained archive contains only those links. Snood and devhell1.xm are absent locally and from that archive. These require reacquisition or another source, not another rsync of the same tree.

18 entries have no registered launch route; this is separate from missing files. Counts describe registered file availability, not gameplay or complete inventory of uncatalogued downloads.

Evidence: `scratch/local-owner-restore-final/report.json`, `scratch/local-owner-restore-final/missing-files.txt`, `scratch/local-owner-restore-final/broken-links.json`.

Broader extracted-tree scan: 49,572 regular files observed before the Morrowind repair, plus 251 broken symbolic links. Local comparison finds 250 self-referential source links; the remaining test/binaries/binaries alias points to the Mac corpus root. These are not 251 additional confirmed missing game assets. Preserve the inventory for cleanup/recovery; do not claim the whole tree is intact.
