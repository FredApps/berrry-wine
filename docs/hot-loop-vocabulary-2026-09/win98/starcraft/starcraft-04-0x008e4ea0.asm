; starcraft-04-0x008e4ea0
; runtime 0x008e4ea0  module smackw32.dll  orig 0x1000eea0
; entries 799295  guest ops 13  retired 10390835  3.21% of window

1000eea0  0f 7e c2                     movd edx, mm0
1000eea3  8b 0d f8 49 01 10            mov ecx, [0x100149f8]
1000eea9  81 e2 ff 0f 00 00            and dword edx, 0xfff
1000eeaf  8b 0c 91                     mov ecx, [ecx+edx*4]
1000eeb2  0f 6e c9                     movd mm1, ecx
1000eeb5  2a c1                        sub al, cl
1000eeb7  0f db cd                     pand mm1, mm5
1000eeba  c1 e9 08                     shr ecx, 0x8
1000eebd  0f d3 c1                     psrlq mm0, mm1
1000eec0  03 0d 94 4a 01 10            add ecx, [0x10014a94]
1000eec6  8b 11                        mov edx, [ecx]
1000eec8  66 3b da                     cmp bx, dx
1000eecb  75 25                        jnz short 0x1000eef2
