; gta2-loading-13-0x0041aa00
; runtime 0x0041aa00  module gta2.exe  orig 0x0041aa00
; entries 12355  guest ops 5  retired 61775  1.07% of window

0041aa00  8a 41 10                     mov al, [ecx+0x10]
0041aa03  56                           push esi
0041aa04  33 f6                        xor esi, esi
0041aa06  84 c0                        test al, al
0041aa08  76 24                        jbe short 0x41aa2e
