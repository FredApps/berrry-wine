; starcraft-06-0x008e4f80
; runtime 0x008e4f80  module smackw32.dll  orig 0x1000ef80
; entries 760075  guest ops 13  retired 9880975  3.05% of window

1000ef80  0f 7e c2                     movd edx, mm0
1000ef83  8b 0d f8 49 01 10            mov ecx, [0x100149f8]
1000ef89  81 e2 ff 0f 00 00            and dword edx, 0xfff
1000ef8f  8b 0c 91                     mov ecx, [ecx+edx*4]
1000ef92  0f 6e c9                     movd mm1, ecx
1000ef95  2a c1                        sub al, cl
1000ef97  0f db cd                     pand mm1, mm5
1000ef9a  c1 e9 08                     shr ecx, 0x8
1000ef9d  0f d3 c1                     psrlq mm0, mm1
1000efa0  03 0d 94 4a 01 10            add ecx, [0x10014a94]
1000efa6  8b 11                        mov edx, [ecx]
1000efa8  66 3b da                     cmp bx, dx
1000efab  75 25                        jnz short 0x1000efd2
