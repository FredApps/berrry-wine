; heroes2-loading-09-0x004976d8
; runtime 0x004976d8  module H2DEMOW.EXE  orig 0x004976d8
; entries 139387  guest ops 14  retired 1951418  2.16% of window

004976d8  8b 45 f4                     mov eax, [ebp-0xc]
004976db  25 00 00 00 08               and eax, 0x8000000
004976e0  89 45 f8                     mov [ebp-0x8], eax
004976e3  d1 65 f4                     shl [ebp-0xc], 1
004976e6  8b 45 e8                     mov eax, [ebp-0x18]
004976e9  33 c9                        xor ecx, ecx
004976eb  8a 08                        mov cl, [eax]
004976ed  01 4d f4                     add [ebp-0xc], ecx
004976f0  8b 45 e8                     mov eax, [ebp-0x18]
004976f3  33 c9                        xor ecx, ecx
004976f5  8a 08                        mov cl, [eax]
004976f7  01 4d fc                     add [ebp-0x4], ecx
004976fa  83 7d f8 00                  cmp dword [ebp-0x8], 0x0
004976fe  0f 84 03 00 00 00            jz 0x497707
