; gta2-gameplay-x87-68-0x004e31fc
; runtime 0x004e31fc  module gta2.exe  orig 0x004e31fc
; entries 620  guest ops 39  retired 24180  0.25% of window

004e31fc  db 05 f8 67 6e 00            fild dword [0x6e67f8]
004e3202  db 03                        fild dword [ebx]
004e3204  a1 28 69 66 00               mov eax, [0x666928]
004e3209  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e320f  d9 c9                        fxch st(1)
004e3211  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e3217  8b 48 70                     mov ecx, [eax+0x70]
004e321a  33 c0                        xor eax, eax
004e321c  89 44 24 10                  mov [esp+0x10], eax
004e3220  89 4c 24 0c                  mov [esp+0xc], ecx
004e3224  df 6c 24 0c                  fild word [esp+0xc]
004e3228  d9 ca                        fxch st(2)
004e322a  de c9                        fmulp st(1), st
004e322c  d9 c9                        fxch st(1)
004e322e  de c1                        faddp st(1), st
004e3230  89 44 24 18                  mov [esp+0x18], eax
004e3234  d9 1e                        fstp dword [esi]
004e3236  db 05 f8 67 6e 00            fild dword [0x6e67f8]
004e323c  db 07                        fild dword [edi]
004e323e  8b 15 28 69 66 00            mov edx, [0x666928]
004e3244  5f                           pop edi
004e3245  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e324b  d9 c9                        fxch st(1)
004e324d  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e3253  8b 42 74                     mov eax, [edx+0x74]
004e3256  89 44 24 10                  mov [esp+0x10], eax
004e325a  df 6c 24 10                  fild word [esp+0x10]
004e325e  d9 ca                        fxch st(2)
004e3260  de c9                        fmulp st(1), st
004e3262  d9 c9                        fxch st(1)
004e3264  de c1                        faddp st(1), st
004e3266  d9 5e 04                     fstp dword [esi+0x4]
004e3269  db 05 d4 67 6e 00            fild dword [0x6e67d4]
004e326f  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e3275  d9 5e 08                     fstp dword [esi+0x8]
004e3278  5e                           pop esi
004e3279  5b                           pop ebx
004e327a  83 c4 10                     add dword esp, 0x10
004e327d  c2 0c 00                     ret 0xc
