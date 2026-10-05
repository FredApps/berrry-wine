; gta2-gameplay-x87-46-0x004e6cfd
; runtime 0x004e6cfd  module gta2.exe  orig 0x004e6cfd
; entries 882  guest ops 41  retired 36162  0.37% of window

004e6cfd  db 44 24 10                  fild dword [esp+0x10]
004e6d01  db 05 44 67 6e 00            fild dword [0x6e6744]
004e6d07  a1 28 69 66 00               mov eax, [0x666928]
004e6d0c  89 5c 24 14                  mov [esp+0x14], ebx
004e6d10  89 5c 24 28                  mov [esp+0x28], ebx
004e6d14  68 f0 6a 6e 00               push 0x6e6af0
004e6d19  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6d1f  d9 c9                        fxch st(1)
004e6d21  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6d27  8b 48 70                     mov ecx, [eax+0x70]
004e6d2a  89 4c 24 14                  mov [esp+0x14], ecx
004e6d2e  51                           push ecx
004e6d2f  df 6c 24 18                  fild word [esp+0x18]
004e6d33  d9 c9                        fxch st(1)
004e6d35  d8 ca                        fmul st, st(2)
004e6d37  db 44 24 24                  fild dword [esp+0x24]
004e6d3b  db 05 54 6a 6e 00            fild dword [0x6e6a54]
004e6d41  d9 cb                        fxch st(3)
004e6d43  de c2                        faddp st(2), st
004e6d45  8b cc                        mov ecx, esp
004e6d47  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6d4d  d9 c9                        fxch st(1)
004e6d4f  d9 1d d0 6a 6e 00            fstp dword [0x6e6ad0]
004e6d55  8b 50 74                     mov edx, [eax+0x74]
004e6d58  a1 8c 68 6e 00               mov eax, [0x6e688c]
004e6d5d  d8 ca                        fmul st, st(2)
004e6d5f  89 54 24 2c                  mov [esp+0x2c], edx
004e6d63  8b 15 74 69 6e 00            mov edx, [0x6e6974]
004e6d69  df 6c 24 2c                  fild word [esp+0x2c]
004e6d6d  d9 ca                        fxch st(2)
004e6d6f  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6d75  d9 ca                        fxch st(2)
004e6d77  de c1                        faddp st(1), st
004e6d79  8d 34 10                     lea esi, [eax+edx]
004e6d7c  d9 1d d4 6a 6e 00            fstp dword [0x6e6ad4]
004e6d82  a1 68 67 6e 00               mov eax, [0x6e6768]
004e6d87  89 74 24 24                  mov [esp+0x24], esi
004e6d8b  d9 1d d8 6a 6e 00            fstp dword [0x6e6ad8]
004e6d91  50                           push eax
004e6d92  dd d8                        fstp st(0)
004e6d94  e8 87 8f fa ff               call 0x48fd20
