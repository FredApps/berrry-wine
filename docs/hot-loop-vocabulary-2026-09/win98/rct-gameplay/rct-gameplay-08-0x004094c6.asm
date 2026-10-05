; rct-gameplay-08-0x004094c6
; runtime 0x004094c6  module RCT.exe  orig 0x004094c6
; entries 135200  guest ops 18  retired 2433600  0.88% of window

004094c6  8b 45 f8                     mov eax, [ebp-0x8]
004094c9  8b 4d 08                     mov ecx, [ebp+0x8]
004094cc  8a 44 81 02                  mov al, [ecx+eax*4+0x2]
004094d0  8b 4d f8                     mov ecx, [ebp-0x8]
004094d3  88 04 8d a0 78 56 00         mov [0x5678a0+ecx*4], al
004094da  8b 45 f8                     mov eax, [ebp-0x8]
004094dd  8b 4d 08                     mov ecx, [ebp+0x8]
004094e0  8a 44 81 01                  mov al, [ecx+eax*4+0x1]
004094e4  8b 4d f8                     mov ecx, [ebp-0x8]
004094e7  88 04 8d a1 78 56 00         mov [0x5678a1+ecx*4], al
004094ee  8b 45 f8                     mov eax, [ebp-0x8]
004094f1  8b 4d 08                     mov ecx, [ebp+0x8]
004094f4  8a 04 81                     mov al, [ecx+eax*4]
004094f7  8b 4d f8                     mov ecx, [ebp-0x8]
004094fa  88 04 8d a2 78 56 00         mov [0x5678a2+ecx*4], al
00409501  8b 45 f8                     mov eax, [ebp-0x8]
00409504  c6 04 85 a3 78 56 00 05      mov byte [0x5678a3+eax*4], 0x5
0040950c  e9 a6 ff ff ff               jmp 0x4094b7
