; rct-loading-11-0x004339dd
; runtime 0x004339dd  module RCT.exe  orig 0x004339dd
; entries 2549585  guest ops 19  retired 48442115  1.38% of window

004339dd  57                           push edi
004339de  8b 3d c8 8f 8d 00            mov edi, [0x8d8fc8]
004339e4  66 3b 45 0c                  cmp ax, [ebp+0xc]
004339e8  66 d1 d7                     rcl di, 1
004339eb  66 3b 5d 0e                  cmp bx, [ebp+0xe]
004339ef  66 d1 d7                     rcl di, 1
004339f2  66 3b 4d 0a                  cmp cx, [ebp+0xa]
004339f6  66 d1 d7                     rcl di, 1
004339f9  c1 c1 10                     rol ecx, 0x10
004339fc  66 3b 55 04                  cmp dx, [ebp+0x4]
00433a00  66 d1 d7                     rcl di, 1
00433a03  66 3b 75 06                  cmp si, [ebp+0x6]
00433a07  66 d1 d7                     rcl di, 1
00433a0a  66 3b 4d 08                  cmp cx, [ebp+0x8]
00433a0e  66 d1 d7                     rcl di, 1
00433a11  c1 c1 10                     rol ecx, 0x10
00433a14  80 bf 0c f9 59 00 00         cmp byte [edi+0x59f90c], 0x0
00433a1b  5f                           pop edi
00433a1c  74 ae                        jz short 0x4339cc
