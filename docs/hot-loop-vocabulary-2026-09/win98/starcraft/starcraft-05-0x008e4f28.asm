; starcraft-05-0x008e4f28
; runtime 0x008e4f28  module smackw32.dll  orig 0x1000ef28
; entries 451053  guest ops 23  retired 10374219  3.21% of window

1000ef28  8a c8                        mov cl, al
1000ef2a  0f 6f 16                     movq mm2, [esi]
1000ef2d  fe c9                        dec byte cl
1000ef2f  83 c6 04                     add dword esi, 0x4
1000ef32  0f 6e c9                     movd mm1, ecx
1000ef35  0f db cd                     pand mm1, mm5
1000ef38  0f f3 d1                     psllq mm2, mm1
1000ef3b  8b 0d f8 49 01 10            mov ecx, [0x100149f8]
1000ef41  0f eb d0                     por mm2, mm0
1000ef44  0f 6f c2                     movq mm0, mm2
1000ef47  0f 7e d2                     movd edx, mm2
1000ef4a  81 e2 ff 0f 00 00            and dword edx, 0xfff
1000ef50  04 20                        add al, 0x20
1000ef52  8b 0c 91                     mov ecx, [ecx+edx*4]
1000ef55  0f 6e c9                     movd mm1, ecx
1000ef58  2a c1                        sub al, cl
1000ef5a  0f db cd                     pand mm1, mm5
1000ef5d  c1 e9 08                     shr ecx, 0x8
1000ef60  0f d3 c1                     psrlq mm0, mm1
1000ef63  03 0d 94 4a 01 10            add ecx, [0x10014a94]
1000ef69  8b 11                        mov edx, [ecx]
1000ef6b  66 3b da                     cmp bx, dx
1000ef6e  75 62                        jnz short 0x1000efd2
