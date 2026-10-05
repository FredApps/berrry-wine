# DirectX7 GetWindowRect native contract

Oracle dx7vb.dll SHA ce95fbf5e51371a3dc6f571b72fd0a1f6b710e33c101d1e7122c45533985e17b, native entry7352d5ef. It forwards HWND and RECT unchanged to USER32.GetWindowRect, maps BOOL false to E_FAIL80004005 and nonzero to S_OK, then RET12. Typelib slot49/c4, HWND LONG + RECT16 in/out, HRESULT. Actual owning call API4076 returned E_NOTIMPL at4312e2.

Candidate reuses handle_GetWindowRect unchanged with owned16-byte heap scratch, then copies four fields through sparse-safe gs32. Native invalid HWND returns E_FAIL, preserves caller bytes and existing last_error1400. Native method does not dereference this. Invalid caller spans return E_POINTER as an explicit safe boundary instead of host fault; scratch allocation failure E_OUTOFMEMORY. No hardcoded dimensions, no invented rects. Internal Win32 ESP cleanup is replaced with the actual COM total16; caller EAX is native-mapped HRESULT. Scratch is freed on success and invalid handle.

Nine focused groups use actual factory slot49 and actual registered top/child windows, negative screen origin/nondefault dimensions, native getter comparison, invalid and destroyed HWND, null/wrapping/unmapped output, sparse noncontiguous output with unrelated backing canary, partial mapping no writes, repeated getter/table/stack preservation. Before control must fail E_NOTIMPL on first actual HWND. Prior11+42 contracts remain scheduled alongside candidate. Nothing compiled or run yet.

Focused before/candidate validation:62 contracts PASS (new9 plus prior11+42), exact receipt scratch/new-games-pipeline-20261004/jigssawme/getwindowrect-repair-20261005/attempt3/receipt.json. Before actual factory call returnsE_NOTIMPL. Production gates and ordinary puzzle remain separate required acceptance.
