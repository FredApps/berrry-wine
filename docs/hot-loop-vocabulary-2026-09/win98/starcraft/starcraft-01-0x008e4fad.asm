; starcraft-01-0x008e4fad
; runtime 0x008e4fad  module smackw32.dll  orig 0x1000efad
; entries 2082721  guest ops 7  retired 14579047  4.51% of window

1000efad  c1 ea 0d                     shr edx, 0xd
1000efb0  fe c8                        dec byte al
1000efb2  81 e2 f8 ff 0f 00            and dword edx, 0xffff8
1000efb8  0f 7e c5                     movd ebp, mm0
1000efbb  0f 73 d0 01                  psrlq mm0, 0x1
1000efbf  c1 ed 01                     shr ebp, 0x1
1000efc2  72 05                        jb short 0x1000efc9
