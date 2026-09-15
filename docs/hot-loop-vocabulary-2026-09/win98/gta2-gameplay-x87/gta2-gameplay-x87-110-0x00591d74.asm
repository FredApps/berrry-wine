; gta2-gameplay-x87-110-0x00591d74
; runtime 0x00591d74  module gta2.exe  orig 0x00591d74
; entries 304  guest ops 43  retired 13072  0.13% of window

00591d74  de c9                        fmulp st(1), st
00591d76  df 6c 24 18                  fild word [esp+0x18]
00591d7a  d9 c9                        fxch st(1)
00591d7c  d8 0d 90 34 6f 00            fmul dword [0x6f3490]
00591d82  d9 c9                        fxch st(1)
00591d84  de c1                        faddp st(1), st
00591d86  d9 1d 88 34 6f 00            fstp dword [0x6f3488]
00591d8c  db 46 1c                     fild dword [esi+0x1c]
00591d8f  db 80 9c 00 00 00            fild dword [eax+0x9c]
00591d95  db 40 60                     fild dword [eax+0x60]
00591d98  d9 ca                        fxch st(2)
00591d9a  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
00591da0  d9 c9                        fxch st(1)
00591da2  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
00591da8  8b 50 74                     mov edx, [eax+0x74]
00591dab  8b 44 24 30                  mov eax, [esp+0x30]
00591daf  de e9                        fsubp st(1), st
00591db1  d9 c9                        fxch st(1)
00591db3  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
00591db9  89 54 24 24                  mov [esp+0x24], edx
00591dbd  8b d1                        mov edx, ecx
00591dbf  de c9                        fmulp st(1), st
00591dc1  df 6c 24 24                  fild word [esp+0x24]
00591dc5  d9 c9                        fxch st(1)
00591dc7  d8 0d 90 34 6f 00            fmul dword [0x6f3490]
00591dcd  d9 cb                        fxch st(3)
00591dcf  d9 1d 40 34 6f 00            fstp dword [0x6f3440]
00591dd5  d9 cb                        fxch st(3)
00591dd7  d9 1d 44 34 6f 00            fstp dword [0x6f3444]
00591ddd  d9 ca                        fxch st(2)
00591ddf  de c1                        faddp st(1), st
00591de1  d9 c9                        fxch st(1)
00591de3  d9 1d 60 34 6f 00            fstp dword [0x6f3460]
00591de9  c7 05 64 34 6f 00 9a 99 99 3e mov dword [0x6f3464], 0x3e99999a
00591df3  a3 80 34 6f 00               mov [0x6f3480], eax
00591df8  d9 1d 8c 34 6f 00            fstp dword [0x6f348c]
00591dfe  89 0d 84 34 6f 00            mov [0x6f3484], ecx
00591e04  c7 05 a0 34 6f 00 9a 99 99 3e mov dword [0x6f34a0], 0x3e99999a
00591e0e  89 15 a4 34 6f 00            mov [0x6f34a4], edx
00591e14  8b 45 30                     mov eax, [ebp+0x30]
00591e17  83 f8 02                     cmp dword eax, 0x2
00591e1a  dd d8                        fstp st(0)
00591e1c  75 09                        jnz short 0x591e27
