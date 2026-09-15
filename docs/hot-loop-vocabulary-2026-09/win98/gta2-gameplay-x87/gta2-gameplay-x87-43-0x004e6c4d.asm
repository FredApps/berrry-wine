; gta2-gameplay-x87-43-0x004e6c4d
; runtime 0x004e6c4d  module gta2.exe  orig 0x004e6c4d
; entries 882  guest ops 43  retired 37926  0.38% of window

004e6c4d  db 44 24 10                  fild dword [esp+0x10]
004e6c51  db 05 44 67 6e 00            fild dword [0x6e6744]
004e6c57  a1 28 69 66 00               mov eax, [0x666928]
004e6c5c  89 5c 24 20                  mov [esp+0x20], ebx
004e6c60  89 5c 24 14                  mov [esp+0x14], ebx
004e6c64  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6c6a  d9 c9                        fxch st(1)
004e6c6c  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6c72  8b 50 70                     mov edx, [eax+0x70]
004e6c75  89 54 24 1c                  mov [esp+0x1c], edx
004e6c79  df 6c 24 1c                  fild word [esp+0x1c]
004e6c7d  d9 c9                        fxch st(1)
004e6c7f  d8 ca                        fmul st, st(2)
004e6c81  db 05 8c 68 6e 00            fild dword [0x6e688c]
004e6c87  d9 ca                        fxch st(2)
004e6c89  de c1                        faddp st(1), st
004e6c8b  d9 c9                        fxch st(1)
004e6c8d  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6c93  d9 c9                        fxch st(1)
004e6c95  d9 1d b0 6a 6e 00            fstp dword [0x6e6ab0]
004e6c9b  8b 40 74                     mov eax, [eax+0x74]
004e6c9e  8b 0d 8c 68 6e 00            mov ecx, [0x6e688c]
004e6ca4  d8 c9                        fmul st, st(1)
004e6ca6  89 44 24 10                  mov [esp+0x10], eax
004e6caa  a1 74 69 6e 00               mov eax, [0x6e6974]
004e6caf  df 6c 24 10                  fild word [esp+0x10]
004e6cb3  8b 15 80 68 6e 00            mov edx, [0x6e6880]
004e6cb9  68 d0 6a 6e 00               push 0x6e6ad0
004e6cbe  de c1                        faddp st(1), st
004e6cc0  8d 34 01                     lea esi, [ecx+eax]
004e6cc3  51                           push ecx
004e6cc4  8d 3c 02                     lea edi, [edx+eax]
004e6cc7  a1 68 67 6e 00               mov eax, [0x6e6768]
004e6ccc  d9 1d b4 6a 6e 00            fstp dword [0x6e6ab4]
004e6cd2  8b cc                        mov ecx, esp
004e6cd4  50                           push eax
004e6cd5  dd d8                        fstp st(0)
004e6cd7  db 05 54 6a 6e 00            fild dword [0x6e6a54]
004e6cdd  89 74 24 28                  mov [esp+0x28], esi
004e6ce1  89 7c 24 1c                  mov [esp+0x1c], edi
004e6ce5  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6ceb  d9 1d b8 6a 6e 00            fstp dword [0x6e6ab8]
004e6cf1  e8 2a 90 fa ff               call 0x48fd20
