; rct-loading-10-0x0044439a
; runtime 0x0044439a  module RCT.exe  orig 0x0044439a
; entries 6047991  guest ops 9  retired 54431919  1.55% of window

0044439a  50                           push eax
0044439b  51                           push ecx
0044439c  25 e0 0f 00 00               and eax, 0xfe0
004443a1  66 c1 e9 05                  shr cx, 0x5
004443a5  c1 e0 02                     shl eax, 0x2
004443a8  66 0b c1                     or ax, cx
004443ab  66 8b 04 45 ce 8f 8d 00      mov ax, [0x8d8fce+eax*2]
004443b3  66 83 f8 ff                  cmp word ax, -0x1
004443b7  0f 84 8f 00 00 00            jz 0x44444c
