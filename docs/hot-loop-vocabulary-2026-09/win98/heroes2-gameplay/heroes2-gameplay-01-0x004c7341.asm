; heroes2-gameplay-01-0x004c7341
; runtime 0x004c7341  module H2DEMOW.EXE  orig 0x004c7341
; entries 1225707  guest ops 7  retired 8579949  5.94% of window

004c7341  33 c0                        xor eax, eax
004c7343  8b 0d 80 5d 52 00            mov ecx, [0x525d80]
004c7349  41                           inc ecx
004c734a  89 0d 80 5d 52 00            mov [0x525d80], ecx
004c7350  8a 41 ff                     mov al, [ecx-0x1]
004c7353  84 c0                        test al, al
004c7355  0f 8d f6 02 00 00            jge 0x4c7651
