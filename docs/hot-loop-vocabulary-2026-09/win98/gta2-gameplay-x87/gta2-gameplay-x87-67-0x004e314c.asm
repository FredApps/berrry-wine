; gta2-gameplay-x87-67-0x004e314c
; runtime 0x004e314c  module gta2.exe  orig 0x004e314c
; entries 620  guest ops 39  retired 24180  0.25% of window

004e314c  db 05 44 67 6e 00            fild dword [0x6e6744]
004e3152  db 03                        fild dword [ebx]
004e3154  a1 28 69 66 00               mov eax, [0x666928]
004e3159  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e315f  d9 c9                        fxch st(1)
004e3161  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e3167  8b 48 70                     mov ecx, [eax+0x70]
004e316a  33 c0                        xor eax, eax
004e316c  89 44 24 10                  mov [esp+0x10], eax
004e3170  89 4c 24 0c                  mov [esp+0xc], ecx
004e3174  df 6c 24 0c                  fild word [esp+0xc]
004e3178  d9 ca                        fxch st(2)
004e317a  de c9                        fmulp st(1), st
004e317c  d9 c9                        fxch st(1)
004e317e  de c1                        faddp st(1), st
004e3180  89 44 24 18                  mov [esp+0x18], eax
004e3184  d9 1e                        fstp dword [esi]
004e3186  db 05 44 67 6e 00            fild dword [0x6e6744]
004e318c  db 07                        fild dword [edi]
004e318e  8b 15 28 69 66 00            mov edx, [0x666928]
004e3194  5f                           pop edi
004e3195  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e319b  d9 c9                        fxch st(1)
004e319d  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e31a3  8b 42 74                     mov eax, [edx+0x74]
004e31a6  89 44 24 10                  mov [esp+0x10], eax
004e31aa  df 6c 24 10                  fild word [esp+0x10]
004e31ae  d9 ca                        fxch st(2)
004e31b0  de c9                        fmulp st(1), st
004e31b2  d9 c9                        fxch st(1)
004e31b4  de c1                        faddp st(1), st
004e31b6  d9 5e 04                     fstp dword [esi+0x4]
004e31b9  db 05 54 6a 6e 00            fild dword [0x6e6a54]
004e31bf  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e31c5  d9 5e 08                     fstp dword [esi+0x8]
004e31c8  5e                           pop esi
004e31c9  5b                           pop ebx
004e31ca  83 c4 10                     add dword esp, 0x10
004e31cd  c2 0c 00                     ret 0xc
