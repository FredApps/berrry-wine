; starcraft-19-0x008e4da0
; runtime 0x008e4da0  module smackw32.dll  orig 0x1000eda0
; entries 354730  guest ops 13  retired 4611490  1.43% of window

1000eda0  0f 7e c2                     movd edx, mm0
1000eda3  8b 0d fc 49 01 10            mov ecx, [0x100149fc]
1000eda9  81 e2 ff 03 00 00            and dword edx, 0x3ff
1000edaf  8b 0c 91                     mov ecx, [ecx+edx*4]
1000edb2  0f 6e c9                     movd mm1, ecx
1000edb5  2a c1                        sub al, cl
1000edb7  0f db cd                     pand mm1, mm5
1000edba  c1 e9 08                     shr ecx, 0x8
1000edbd  0f d3 c1                     psrlq mm0, mm1
1000edc0  03 0d 94 4a 01 10            add ecx, [0x10014a94]
1000edc6  8b 11                        mov edx, [ecx]
1000edc8  66 3b da                     cmp bx, dx
1000edcb  75 25                        jnz short 0x1000edf2
