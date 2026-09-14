; quake2-25-0x00d9280c
; runtime 0x00d9280c  module ref_soft.dll  orig 0x1001480c
; entries 336660  guest ops 5  retired 1683300  0.46% of window

1001480c  81 e9 00 10 00 00            sub dword ecx, 0x1000
10014812  2d 00 10 00 00               sub eax, 0x1000
10014817  85 01                        test [ecx], eax
10014819  3d 00 10 00 00               cmp eax, 0x1000
1001481e  73 ec                        jnb short 0x1001480c
