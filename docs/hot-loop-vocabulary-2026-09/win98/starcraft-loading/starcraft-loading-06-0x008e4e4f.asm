; starcraft-loading-06-0x008e4e4f
; runtime 0x008e4e4f  module smackw32.dll  orig 0x1000ee4f
; entries 2909284  guest ops 23  retired 66913532  3.06% of window

1000ee4f  8a c8                        mov cl, al
1000ee51  0f 6f 16                     movq mm2, [esi]
1000ee54  fe c9                        dec byte cl
1000ee56  83 c6 04                     add dword esi, 0x4
1000ee59  0f 6e c9                     movd mm1, ecx
1000ee5c  0f db cd                     pand mm1, mm5
1000ee5f  0f f3 d1                     psllq mm2, mm1
1000ee62  8b 0d f8 49 01 10            mov ecx, [0x100149f8]
1000ee68  0f eb d0                     por mm2, mm0
1000ee6b  0f 6f c2                     movq mm0, mm2
1000ee6e  0f 7e d2                     movd edx, mm2
1000ee71  81 e2 ff 0f 00 00            and dword edx, 0xfff
1000ee77  04 20                        add al, 0x20
1000ee79  8b 0c 91                     mov ecx, [ecx+edx*4]
1000ee7c  0f 6e c9                     movd mm1, ecx
1000ee7f  2a c1                        sub al, cl
1000ee81  0f db cd                     pand mm1, mm5
1000ee84  c1 e9 08                     shr ecx, 0x8
1000ee87  0f d3 c1                     psrlq mm0, mm1
1000ee8a  03 0d 94 4a 01 10            add ecx, [0x10014a94]
1000ee90  8b 11                        mov edx, [ecx]
1000ee92  66 3b da                     cmp bx, dx
1000ee95  75 5b                        jnz short 0x1000eef2
