# Compact fixture staging — 2026-10-03

Staged **671 regular files, 81,739,192 bytes** to `scratch/migration-compact-staging-20261003/payload/`. No live fixture writes. Exact per-file archive mappings and SHA-256 values: `scratch/migration-compact-staging-20261003/staging-receipt.json`. Full archive SHA-256 `f816abfcadf152cebfadae71fe8ac7aef41b2bf6e9d57f203f7bece3d8d5b892` matched while extracting; independent staged-file rehash passed for all671.

Manifest inspection: `scratch/migration-compact-staging-20261003/manifest-review.json`. Jardinains115 manifest entries and Little Fighter2517 manifest entries all resolve to staged files. Neither manifest references the excluded obsolete absolute `visit` or `support` symlinks. Marbles26 declared files, Pawn6, and Spider4 are staged or already present (existing Spider dependency hash pinned).

This establishes declared fixture availability after root installs the staged files. Dynamic dependency loading, gameplay and FPS remain unverified. Root owns live copy at a browser-free boundary.
