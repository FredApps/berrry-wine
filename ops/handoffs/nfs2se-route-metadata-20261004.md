# NFS2SE manifest-root validation

Implemented only ops/emulator-server.js and its focused test. Exact app ID + manifest + executable binding admits listed assets only under build/nfs2se-demo/. Existing fixture roots and exact realpath protections unchanged; arbitrary build files remain excluded.

Five focused tests pass, covering complete/missing closure, each registry binding, private/traversal/URL/path rejection and symlink denial, plus existing gateway/range coverage. Actual catalog now reports Registered files are missing with all72exact missingPaths, available:false; it no longer hides them behind invalid metadata. No browser/build/restart/push.

Receipt and hashes: scratch/nfs2se-route-metadata-20261003/implementation-receipt.json. Source files released to root for review.
