; gta2-gameplay-09-0x004e30a0
; runtime 0x004e30a0  module gta2.exe  orig 0x004e30a0
; entries 39879  guest ops 28  retired 1116612  1.80% of window

004e30a0  8b 0d 28 69 66 00            mov ecx, [0x666928]
004e30a6  8b 44 24 10                  mov eax, [esp+0x10]
004e30aa  56                           push esi
004e30ab  8b 74 24 08                  mov esi, [esp+0x8]
004e30af  8b 91 98 00 00 00            mov edx, [ecx+0x98]
004e30b5  2d 90 6a 6e 00               sub eax, 0x6e6a90
004e30ba  03 d6                        add edx, esi
004e30bc  5e                           pop esi
004e30bd  89 54 24 10                  mov [esp+0x10], edx
004e30c1  8b 54 24 08                  mov edx, [esp+0x8]
004e30c5  db 44 24 10                  fild dword [esp+0x10]
004e30c9  c1 f8 05                     sar eax, 0x5
004e30cc  83 c0 04                     add dword eax, 0x4
004e30cf  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e30d5  c1 e0 05                     shl eax, 0x5
004e30d8  d9 98 90 6a 6e 00            fstp dword [eax+0x6e6a90]
004e30de  8b 89 9c 00 00 00            mov ecx, [ecx+0x9c]
004e30e4  db 44 24 0c                  fild dword [esp+0xc]
004e30e8  03 ca                        add ecx, edx
004e30ea  89 4c 24 10                  mov [esp+0x10], ecx
004e30ee  db 44 24 10                  fild dword [esp+0x10]
004e30f2  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e30f8  d9 c9                        fxch st(1)
004e30fa  d8 0d 70 08 5f 00            fmul dword [0x5f0870]
004e3100  d9 c9                        fxch st(1)
004e3102  d9 98 94 6a 6e 00            fstp dword [eax+0x6e6a94]
004e3108  d9 98 98 6a 6e 00            fstp dword [eax+0x6e6a98]
004e310e  c2 10 00                     ret 0x10
