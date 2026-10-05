; quake2-gameplay-15-0x00d904d9
; runtime 0x00d904d9  module ref_soft.dll  orig 0x100124d9
; entries 1339055  guest ops 21  retired 28120155  0.94% of window

100124d9  db 46 04                     fild dword [esi+0x4]
100124dc  db 06                        fild dword [esi]
100124de  8b 4e 04                     mov ecx, [esi+0x4]
100124e1  8b 3d bc 7a 02 10            mov edi, [0x10027abc]
100124e7  d8 0d 84 7a 02 10            fmul dword [0x10027a84]
100124ed  d9 c9                        fxch st(1)
100124ef  d8 0d 90 7a 02 10            fmul dword [0x10027a90]
100124f5  d9 c9                        fxch st(1)
100124f7  d8 05 9c 7a 02 10            fadd dword [0x10027a9c]
100124fd  0f af 0d c0 7a 02 10         imul ecx, [0x10027ac0]
10012504  de c1                        faddp st(1), st
10012506  d8 15 50 7a 02 10            fcom dword [0x10027a50]
1001250c  03 f9                        add edi, ecx
1001250e  8b 16                        mov edx, [esi]
10012510  03 d2                        add edx, edx
10012512  8b 4e 08                     mov ecx, [esi+0x8]
10012515  03 fa                        add edi, edx
10012517  56                           push esi
10012518  df e0                        fnstsw ax
1001251a  f6 c4 45                     test ah, 0x45
1001251d  0f 84 6c ff ff ff            jz 0x1001248f
