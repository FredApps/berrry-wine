; gta2-loading-09-0x004ab6bf
; runtime 0x004ab6bf  module gta2.exe  orig 0x004ab6bf
; entries 12353  guest ops 6  retired 74118  1.29% of window

004ab6bf  33 c9                        xor ecx, ecx
004ab6c1  88 86 a0 6f 00 00            mov [esi+0x6fa0], al
004ab6c7  8a 86 d3 00 00 00            mov al, [esi+0xd3]
004ab6cd  24 80                        and al, 0x80
004ab6cf  88 8e 99 6f 00 00            mov [esi+0x6f99], cl
004ab6d5  74 0f                        jz short 0x4ab6e6
