; quake2-gameplay-x87-87-0x00d90795
; runtime 0x00d90795  module ref_soft.dll  orig 0x10012795
; entries 30294  guest ops 14  retired 424116  0.22% of window

10012795  d9 05 7c 79 02 10            fld dword [0x1002797c]
1001279b  d9 cb                        fxch st(3)
1001279d  d9 05 84 79 02 10            fld dword [0x10027984]
100127a3  d9 cb                        fxch st(3)
100127a5  d9 05 80 79 02 10            fld dword [0x10027980]
100127ab  d9 cb                        fxch st(3)
100127ad  db 15 04 1b 03 10            fist dword [0x10031b04]
100127b3  d9 2d 88 19 03 10            fldcw dword [0x10031988]
100127b9  d9 15 84 43 03 10            fst dword [0x10034384]
100127bf  d9 cc                        fxch st(4)
100127c1  d8 d1                        fcom st, st(1)
100127c3  df e0                        fnstsw ax
100127c5  f6 c4 01                     test ah, 0x1
100127c8  74 04                        jz short 0x100127ce
