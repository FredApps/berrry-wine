; gta2-gameplay-x87-50-0x004e6da6
; runtime 0x004e6da6  module gta2.exe  orig 0x004e6da6
; entries 882  guest ops 35  retired 30870  0.31% of window

004e6da6  db 05 80 68 6e 00            fild dword [0x6e6880]
004e6dac  db 05 44 67 6e 00            fild dword [0x6e6744]
004e6db2  a1 28 69 66 00               mov eax, [0x666928]
004e6db7  89 5c 24 28                  mov [esp+0x28], ebx
004e6dbb  89 5c 24 14                  mov [esp+0x14], ebx
004e6dbf  8b 0d 2c 67 6e 00            mov ecx, [0x6e672c]
004e6dc5  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6dcb  d9 c9                        fxch st(1)
004e6dcd  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6dd3  8b 50 70                     mov edx, [eax+0x70]
004e6dd6  81 e1 ff 03 00 00            and dword ecx, 0x3ff
004e6ddc  89 54 24 24                  mov [esp+0x24], edx
004e6de0  51                           push ecx
004e6de1  df 6c 24 28                  fild word [esp+0x28]
004e6de5  d9 c9                        fxch st(1)
004e6de7  d8 ca                        fmul st, st(2)
004e6de9  db 44 24 20                  fild dword [esp+0x20]
004e6ded  d9 ca                        fxch st(2)
004e6def  de c1                        faddp st(1), st
004e6df1  d9 c9                        fxch st(1)
004e6df3  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6df9  d9 c9                        fxch st(1)
004e6dfb  d9 1d f0 6a 6e 00            fstp dword [0x6e6af0]
004e6e01  8b 40 74                     mov eax, [eax+0x74]
004e6e04  8b 0d b0 3b 6f 00            mov ecx, [0x6f3bb0]
004e6e0a  d8 c9                        fmul st, st(1)
004e6e0c  89 44 24 14                  mov [esp+0x14], eax
004e6e10  df 6c 24 14                  fild word [esp+0x14]
004e6e14  de c1                        faddp st(1), st
004e6e16  d9 1d f4 6a 6e 00            fstp dword [0x6e6af4]
004e6e1c  dd d8                        fstp st(0)
004e6e1e  db 05 54 6a 6e 00            fild dword [0x6e6a54]
004e6e24  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e6e2a  d9 1d f8 6a 6e 00            fstp dword [0x6e6af8]
004e6e30  e8 bb 63 0b 00               call 0x59d1f0
