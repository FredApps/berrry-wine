; starcraft-loading-02-0x008e4ecd
; runtime 0x008e4ecd  module smackw32.dll  orig 0x1000eecd
; entries 13689637  guest ops 7  retired 95827459  4.38% of window

1000eecd  c1 ea 0d                     shr edx, 0xd
1000eed0  fe c8                        dec byte al
1000eed2  81 e2 f8 ff 0f 00            and dword edx, 0xffff8
1000eed8  0f 7e c5                     movd ebp, mm0
1000eedb  0f 73 d0 01                  psrlq mm0, 0x1
1000eedf  c1 ed 01                     shr ebp, 0x1
1000eee2  72 05                        jb short 0x1000eee9
