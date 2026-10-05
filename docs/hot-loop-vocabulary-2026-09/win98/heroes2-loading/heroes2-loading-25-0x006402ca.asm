; heroes2-loading-25-0x006402ca
; runtime 0x006402ca  module MSS32.DLL  orig 0x200012ca
; entries 50047  guest ops 15  retired 750705  0.83% of window

200012ca  a1 a0 06 02 20               mov eax, [0x200206a0]
200012cf  8b 0d 3c d0 01 20            mov ecx, [0x2001d03c]
200012d5  c1 e0 05                     shl eax, 0x5
200012d8  03 c1                        add eax, ecx
200012da  8b 50 10                     mov edx, [eax+0x10]
200012dd  8b 58 0c                     mov ebx, [eax+0xc]
200012e0  2b da                        sub ebx, edx
200012e2  89 58 0c                     mov [eax+0xc], ebx
200012e5  a1 a0 06 02 20               mov eax, [0x200206a0]
200012ea  c1 e0 05                     shl eax, 0x5
200012ed  8b 0d 3c d0 01 20            mov ecx, [0x2001d03c]
200012f3  03 c1                        add eax, ecx
200012f5  8b 50 08                     mov edx, [eax+0x8]
200012f8  52                           push edx
200012f9  ff 50 04                     call [eax+0x4]
