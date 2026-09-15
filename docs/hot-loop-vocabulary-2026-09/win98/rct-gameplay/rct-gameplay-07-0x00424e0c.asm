; rct-gameplay-07-0x00424e0c
; runtime 0x00424e0c  module RCT.exe  orig 0x00424e0c
; entries 104000  guest ops 46  retired 4784000  1.72% of window

00424e0c  66 a1 78 e8 82 00            mov ax, [0x82e878]
00424e12  66 33 c9                     xor cx, cx
00424e15  66 33 d2                     xor dx, dx
00424e18  66 d1 e8                     shr ax, 1
00424e1b  66 d1 d1                     rcl cx, 1
00424e1e  66 d1 e8                     shr ax, 1
00424e21  66 d1 d2                     rcl dx, 1
00424e24  66 d1 e8                     shr ax, 1
00424e27  66 d1 d1                     rcl cx, 1
00424e2a  66 d1 e8                     shr ax, 1
00424e2d  66 d1 d2                     rcl dx, 1
00424e30  66 d1 e8                     shr ax, 1
00424e33  66 d1 d1                     rcl cx, 1
00424e36  66 d1 e8                     shr ax, 1
00424e39  66 d1 d2                     rcl dx, 1
00424e3c  66 d1 e8                     shr ax, 1
00424e3f  66 d1 d1                     rcl cx, 1
00424e42  66 d1 e8                     shr ax, 1
00424e45  66 d1 d2                     rcl dx, 1
00424e48  66 d1 e8                     shr ax, 1
00424e4b  66 d1 d1                     rcl cx, 1
00424e4e  66 d1 e8                     shr ax, 1
00424e51  66 d1 d2                     rcl dx, 1
00424e54  66 d1 e8                     shr ax, 1
00424e57  66 d1 d1                     rcl cx, 1
00424e5a  66 d1 e8                     shr ax, 1
00424e5d  66 d1 d2                     rcl dx, 1
00424e60  66 d1 e8                     shr ax, 1
00424e63  66 d1 d1                     rcl cx, 1
00424e66  66 d1 e8                     shr ax, 1
00424e69  66 d1 d2                     rcl dx, 1
00424e6c  66 c1 e2 07                  shl dx, 0x7
00424e70  66 0b ca                     or cx, dx
00424e73  66 8b c1                     mov ax, cx
00424e76  66 83 e0 7f                  and word ax, 0x7f
00424e7a  66 c1 e9 07                  shr cx, 0x7
00424e7e  66 c1 e0 05                  shl ax, 0x5
00424e82  66 c1 e1 05                  shl cx, 0x5
00424e86  66 8b f1                     mov si, cx
00424e89  66 c1 c6 07                  rol si, 0x7
00424e8d  66 0b f0                     or si, ax
00424e90  66 c1 ce 05                  ror si, 0x5
00424e94  0f b7 f6                     movzx esi, word esi
00424e97  8b 34 b5 34 8f 8b 00         mov esi, [0x8b8f34+esi*4]
00424e9e  f6 06 3c                     test [esi], 0x3c
00424ea1  74 0e                        jz short 0x424eb1
