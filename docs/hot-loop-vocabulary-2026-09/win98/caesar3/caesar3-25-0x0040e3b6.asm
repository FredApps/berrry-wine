; caesar3-25-0x0040e3b6
; runtime 0x0040e3b6  module c3.exe  orig 0x0040e3b6
; entries 672176  guest ops 5  retired 3360880  1.04% of window

0040e3b6  8b 4d f8                     mov ecx, [ebp-0x8]
0040e3b9  8b 14 8d 00 88 86 00         mov edx, [0x868800+ecx*4]
0040e3c0  03 55 fc                     add edx, [ebp-0x4]
0040e3c3  39 15 8c 87 52 00            cmp [0x52878c], edx
0040e3c9  7c 1a                        jl short 0x40e3e5
