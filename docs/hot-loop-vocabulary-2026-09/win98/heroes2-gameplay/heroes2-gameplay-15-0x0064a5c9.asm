; heroes2-gameplay-15-0x0064a5c9
; runtime 0x0064a5c9  module MSS32.DLL  orig 0x2000b5c9
; entries 235760  guest ops 8  retired 1886080  1.31% of window

2000b5c9  a1 e8 08 02 20               mov eax, [0x200208e8]
2000b5ce  8b 0d f4 08 02 20            mov ecx, [0x200208f4]
2000b5d4  48                           dec eax
2000b5d5  81 c1 d4 08 00 00            add dword ecx, 0x8d4
2000b5db  a3 e8 08 02 20               mov [0x200208e8], eax
2000b5e0  89 0d f4 08 02 20            mov [0x200208f4], ecx
2000b5e6  85 c0                        test eax, eax
2000b5e8  0f 85 65 fe ff ff            jnz 0x2000b453
