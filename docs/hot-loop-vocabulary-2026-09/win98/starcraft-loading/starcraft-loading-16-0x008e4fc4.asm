; starcraft-loading-16-0x008e4fc4
; runtime 0x008e4fc4  module smackw32.dll  orig 0x1000efc4
; entries 6879697  guest ops 5  retired 34398485  1.57% of window

1000efc4  ba 04 00 00 00               mov edx, 0x4
1000efc9  03 ca                        add ecx, edx
1000efcb  8b 11                        mov edx, [ecx]
1000efcd  66 3b da                     cmp bx, dx
1000efd0  74 db                        jz short 0x1000efad
