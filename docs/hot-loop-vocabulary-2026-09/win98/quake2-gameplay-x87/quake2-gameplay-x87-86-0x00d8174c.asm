; quake2-gameplay-x87-86-0x00d8174c
; runtime 0x00d8174c  module ref_soft.dll  orig 0x1000374c
; entries 21276  guest ops 20  retired 425520  0.22% of window

1000374c  d9 44 24 20                  fld dword [esp+0x20]
10003750  8b 11                        mov edx, [ecx]
10003752  8b 41 08                     mov eax, [ecx+0x8]
10003755  d9 44 24 1c                  fld dword [esp+0x1c]
10003759  d8 4a 04                     fmul dword [edx+0x4]
1000375c  d9 44 24 18                  fld dword [esp+0x18]
10003760  d9 ca                        fxch st(2)
10003762  d8 4a 08                     fmul dword [edx+0x8]
10003765  d9 ca                        fxch st(2)
10003767  d8 0a                        fmul dword [edx]
10003769  d9 ca                        fxch st(2)
1000376b  de c1                        faddp st(1), st
1000376d  d9 c9                        fxch st(1)
1000376f  89 44 24 30                  mov [esp+0x30], eax
10003773  de c1                        faddp st(1), st
10003775  d8 64 24 24                  fsub dword [esp+0x24]
10003779  d8 15 30 02 02 10            fcom dword [0x10020230]
1000377f  df e0                        fnstsw ax
10003781  f6 c4 41                     test ah, 0x41
10003784  75 04                        jnz short 0x1000378a
