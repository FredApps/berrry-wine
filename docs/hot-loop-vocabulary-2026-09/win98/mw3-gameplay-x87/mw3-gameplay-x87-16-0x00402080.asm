; mw3-gameplay-x87-16-0x00402080
; runtime 0x00402080  module mech3demo.exe  orig 0x00402080
; entries 45531  guest ops 22  retired 1001682  0.91% of window

00402080  55                           push ebp
00402081  8b ec                        mov ebp, esp
00402083  83 ec 08                     sub dword esp, 0x8
00402086  53                           push ebx
00402087  56                           push esi
00402088  57                           push edi
00402089  89 4d f8                     mov [ebp-0x8], ecx
0040208c  8b 4d f8                     mov ecx, [ebp-0x8]
0040208f  d9 01                        fld dword [ecx]
00402091  dc c8                        fmul st(0), st
00402093  d9 41 04                     fld dword [ecx+0x4]
00402096  d9 41 08                     fld dword [ecx+0x8]
00402099  dc c8                        fmul st(0), st
0040209b  d9 c9                        fxch st(1)
0040209d  dc c8                        fmul st(0), st
0040209f  d9 c9                        fxch st(1)
004020a1  de c2                        faddp st(2), st
004020a3  de c1                        faddp st(1), st
004020a5  d9 fa                        fsqrt
004020a7  d9 55 fc                     fst dword [ebp-0x4]
004020aa  f7 45 fc ff ff ff 7f         test [ebp-0x4], 0x7fffffff
004020b1  74 23                        jz short 0x4020d6
