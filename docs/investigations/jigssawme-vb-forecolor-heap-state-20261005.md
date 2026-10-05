# Foreground state without global layout growth

The initial foreground implementation passed33 focused native/pixel/lifetime contracts, but full production gates rejected its additional64KiB allocated region: the gap/pad shake layouts could not place THREAD_MSG_QUEUES_HIGH. An earlier missing SIZE declaration had also been caught and corrected. Both failed logs remain preserved; neither gate was waived.

This redesign removes the new region and restores src/00-regions.wat and lib/region-map.generated.js byte-for-byte to the prior ed3a layout. The existing DX_SURF_META table has16-byte slots with established caps at0, parent at4 and billed bytes at8. A complete src/lib/test use audit found no consumer of the fourth word. It now explicitly owns a lazy eight-byte guest-heap allocation containing raw foreground COLORREF and an owned GDI pen.

Heap allocation failure returns E_OUTOFMEMORY without creating a pen or publishing partial ownership. Once state exists, native color-before-CreatePen failure ordering remains unchanged. Final free and slot reset clear the ownership pointer before deleting the pen and freeing the heap block. All three native creation sites zero the16-byte metadata only after dx_create_com_obj has called that reset. Caps, parent and billed bytes are preserved by the setter.

Session78046 passed34 focused groups in5.408seconds: prior33 adapted behavior/pixel/lifetime cases plus ownership and adjacent-metadata isolation. The matched old-sidecar control fails the new heap-owner assertion. That failure is a structural storage distinction, NOT a native behavior regression; the old sidecar already passed native pixel behavior. Auxiliary-instance checks read shared ownership/state and observe final pointer clearing without dereferencing freed heap storage.

No global capacity is reduced or expanded. Full production/shake gates remain required. DrawText is a separate unvalidated increment; no puzzle or FPS qualification follows from these contracts.
