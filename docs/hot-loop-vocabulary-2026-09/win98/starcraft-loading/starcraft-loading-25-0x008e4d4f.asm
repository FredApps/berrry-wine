; starcraft-loading-25-0x008e4d4f
; runtime 0x008e4d4f  module smackw32.dll  orig 0x1000ed4f
; entries 1063708  guest ops 23  retired 24465284  1.12% of window

1000ed4f  8a c8                        mov cl, al
1000ed51  0f 6f 16                     movq mm2, [esi]
1000ed54  fe c9                        dec byte cl
1000ed56  83 c6 04                     add dword esi, 0x4
1000ed59  0f 6e c9                     movd mm1, ecx
1000ed5c  0f db cd                     pand mm1, mm5
1000ed5f  0f f3 d1                     psllq mm2, mm1
1000ed62  8b 0d fc 49 01 10            mov ecx, [0x100149fc]
1000ed68  0f eb d0                     por mm2, mm0
1000ed6b  0f 6f c2                     movq mm0, mm2
1000ed6e  0f 7e d2                     movd edx, mm2
1000ed71  81 e2 ff 03 00 00            and dword edx, 0x3ff
1000ed77  04 20                        add al, 0x20
1000ed79  8b 0c 91                     mov ecx, [ecx+edx*4]
1000ed7c  0f 6e c9                     movd mm1, ecx
1000ed7f  2a c1                        sub al, cl
1000ed81  0f db cd                     pand mm1, mm5
1000ed84  c1 e9 08                     shr ecx, 0x8
1000ed87  0f d3 c1                     psrlq mm0, mm1
1000ed8a  03 0d 94 4a 01 10            add ecx, [0x10014a94]
1000ed90  8b 11                        mov edx, [ecx]
1000ed92  66 3b da                     cmp bx, dx
1000ed95  75 5b                        jnz short 0x1000edf2
