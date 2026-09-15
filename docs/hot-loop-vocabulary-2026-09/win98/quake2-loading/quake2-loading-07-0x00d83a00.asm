; quake2-loading-07-0x00d83a00
; runtime 0x00d83a00  module ref_soft.dll  orig 0x10005a00
; entries 1990555  guest ops 4  retired 7962220  2.90% of window

10005a00  33 c0                        xor eax, eax
10005a02  8a 04 11                     mov al, [ecx+edx]
10005a05  3d ff 00 00 00               cmp eax, 0xff
10005a0a  75 03                        jnz short 0x10005a0f
