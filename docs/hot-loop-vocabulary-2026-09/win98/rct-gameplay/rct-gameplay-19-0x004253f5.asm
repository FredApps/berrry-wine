; rct-gameplay-19-0x004253f5
; runtime 0x004253f5  module RCT.exe  orig 0x004253f5
; entries 103812  guest ops 8  retired 830496  0.30% of window

004253f5  66 8b f1                     mov si, cx
004253f8  66 c1 c6 07                  rol si, 0x7
004253fc  66 0b f0                     or si, ax
004253ff  66 c1 ce 05                  ror si, 0x5
00425403  0f b7 f6                     movzx esi, word esi
00425406  8b 34 b5 34 8f 8b 00         mov esi, [0x8b8f34+esi*4]
0042540d  f6 06 3c                     test [esi], 0x3c
00425410  74 08                        jz short 0x42541a
