; mw3long-15-0x0046aded
; runtime 0x0046aded  module mech3demo.exe  orig 0x0046aded
; entries 50469  guest ops 7  retired 353283  0.13% of window

0046aded  8b 4c 24 0c                  mov ecx, [esp+0xc]
0046adf1  5f                           pop edi
0046adf2  33 c0                        xor eax, eax
0046adf4  64 89 0d 00 00 00 00         fs: mov [0x0], ecx
0046adfb  5e                           pop esi
0046adfc  83 c4 10                     add dword esp, 0x10
0046adff  c3                           ret
