; mw3long-09-0x004f7610
; runtime 0x004f7610  module mech3demo.exe  orig 0x004f7610
; entries 50470  guest ops 8  retired 403760  0.15% of window

004f7610  a1 14 c9 5f 00               mov eax, [0x5fc914]
004f7615  8b 15 10 c9 5f 00            mov edx, [0x5fc910]
004f761b  53                           push ebx
004f761c  56                           push esi
004f761d  33 db                        xor ebx, ebx
004f761f  33 f6                        xor esi, esi
004f7621  3b c3                        cmp eax, ebx
004f7623  76 5d                        jbe short 0x4f7682
