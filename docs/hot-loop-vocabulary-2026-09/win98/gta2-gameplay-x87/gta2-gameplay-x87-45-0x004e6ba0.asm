; gta2-gameplay-x87-45-0x004e6ba0
; runtime 0x004e6ba0  module gta2.exe  orig 0x004e6ba0
; entries 882  guest ops 41  retired 36162  0.37% of window

004e6ba0  db 05 80 68 6e 00            fild dword [0x6e6880]
004e6ba6  db 05 44 67 6e 00            fild dword [0x6e6744]
004e6bac  a1 28 69 66 00               mov eax, [0x666928]
004e6bb1  89 5c 24 20                  mov [esp+0x20], ebx
004e6bb5  89 5c 24 14                  mov [esp+0x14], ebx
004e6bb9  68 b0 6a 6e 00               push 0x6e6ab0
004e6bbe  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6bc4  d9 c9                        fxch st(1)
004e6bc6  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6bcc  8b 48 70                     mov ecx, [eax+0x70]
004e6bcf  89 4c 24 20                  mov [esp+0x20], ecx
004e6bd3  51                           push ecx
004e6bd4  df 6c 24 24                  fild word [esp+0x24]
004e6bd8  d9 c9                        fxch st(1)
004e6bda  d8 ca                        fmul st, st(2)
004e6bdc  db 05 8c 68 6e 00            fild dword [0x6e688c]
004e6be2  db 05 54 6a 6e 00            fild dword [0x6e6a54]
004e6be8  d9 cb                        fxch st(3)
004e6bea  de c2                        faddp st(2), st
004e6bec  8b cc                        mov ecx, esp
004e6bee  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6bf4  d9 c9                        fxch st(1)
004e6bf6  d9 1d 90 6a 6e 00            fstp dword [0x6e6a90]
004e6bfc  8b 50 74                     mov edx, [eax+0x74]
004e6bff  a1 80 68 6e 00               mov eax, [0x6e6880]
004e6c04  d8 ca                        fmul st, st(2)
004e6c06  89 54 24 18                  mov [esp+0x18], edx
004e6c0a  8b 15 74 69 6e 00            mov edx, [0x6e6974]
004e6c10  df 6c 24 18                  fild word [esp+0x18]
004e6c14  d9 ca                        fxch st(2)
004e6c16  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6c1c  d9 ca                        fxch st(2)
004e6c1e  de c1                        faddp st(1), st
004e6c20  8d 34 10                     lea esi, [eax+edx]
004e6c23  a1 68 67 6e 00               mov eax, [0x6e6768]
004e6c28  50                           push eax
004e6c29  89 74 24 1c                  mov [esp+0x1c], esi
004e6c2d  d9 1d 94 6a 6e 00            fstp dword [0x6e6a94]
004e6c33  d9 1d 98 6a 6e 00            fstp dword [0x6e6a98]
004e6c39  dd d8                        fstp st(0)
004e6c3b  e8 e0 90 fa ff               call 0x48fd20
