; starcraft-loading-17-0x008e4ee4
; runtime 0x008e4ee4  module smackw32.dll  orig 0x1000eee4
; entries 6843480  guest ops 5  retired 34217400  1.56% of window

1000eee4  ba 04 00 00 00               mov edx, 0x4
1000eee9  03 ca                        add ecx, edx
1000eeeb  8b 11                        mov edx, [ecx]
1000eeed  66 3b da                     cmp bx, dx
1000eef0  74 db                        jz short 0x1000eecd
