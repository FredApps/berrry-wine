; quake2-gameplay-x87-100-0x00d8178f
; runtime 0x00d8178f  module ref_soft.dll  orig 0x1000378f
; entries 21276  guest ops 18  retired 382968  0.19% of window

1000378f  d9 44 24 1c                  fld dword [esp+0x1c]
10003793  8b 79 04                     mov edi, [ecx+0x4]
10003796  d9 44 24 20                  fld dword [esp+0x20]
1000379a  d8 4f 08                     fmul dword [edi+0x8]
1000379d  d9 44 24 18                  fld dword [esp+0x18]
100037a1  d9 ca                        fxch st(2)
100037a3  d8 4f 04                     fmul dword [edi+0x4]
100037a6  d9 ca                        fxch st(2)
100037a8  d8 0f                        fmul dword [edi]
100037aa  d9 ca                        fxch st(2)
100037ac  de c1                        faddp st(1), st
100037ae  d9 c9                        fxch st(1)
100037b0  de c1                        faddp st(1), st
100037b2  d8 64 24 24                  fsub dword [esp+0x24]
100037b6  d8 15 30 02 02 10            fcom dword [0x10020230]
100037bc  df e0                        fnstsw ax
100037be  f6 c4 41                     test ah, 0x41
100037c1  75 04                        jnz short 0x100037c7
