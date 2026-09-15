; heroes2-gameplay-07-0x004712a3
; runtime 0x004712a3  module H2DEMOW.EXE  orig 0x004712a3
; entries 231834  guest ops 13  retired 3013842  2.09% of window

004712a3  8b 45 fc                     mov eax, [ebp-0x4]
004712a6  8b 80 ae 00 00 00            mov eax, [eax+0xae]
004712ac  8b 40 08                     mov eax, [eax+0x8]
004712af  0f af 45 0c                  imul eax, [ebp+0xc]
004712b3  8d 04 40                     lea eax, [eax+eax*2]
004712b6  c1 e0 02                     shl eax, 0x2
004712b9  8b 4d fc                     mov ecx, [ebp-0x4]
004712bc  8b 89 ae 00 00 00            mov ecx, [ecx+0xae]
004712c2  03 01                        add eax, [ecx]
004712c4  8b 4d 08                     mov ecx, [ebp+0x8]
004712c7  8d 0c 49                     lea ecx, [ecx+ecx*2]
004712ca  8d 04 88                     lea eax, [eax+ecx*4]
004712cd  e9 00 00 00 00               jmp 0x4712d2
