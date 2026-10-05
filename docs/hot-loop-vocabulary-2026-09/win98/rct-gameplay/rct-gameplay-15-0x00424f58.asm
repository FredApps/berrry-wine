; rct-gameplay-15-0x00424f58
; runtime 0x00424f58  module RCT.exe  orig 0x00424f58
; entries 104000  guest ops 10  retired 1040000  0.37% of window

00424f58  66 8b f1                     mov si, cx
00424f5b  66 c1 c6 07                  rol si, 0x7
00424f5f  66 0b f0                     or si, ax
00424f62  66 c1 ce 05                  ror si, 0x5
00424f66  0f b7 f6                     movzx esi, word esi
00424f69  8b 34 b5 34 8f 8b 00         mov esi, [0x8b8f34+esi*4]
00424f70  8a 1e                        mov bl, [esi]
00424f72  80 e3 3c                     and byte bl, 0x3c
00424f75  80 fb 0c                     cmp byte bl, 0xc
00424f78  74 26                        jz short 0x424fa0
