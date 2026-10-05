; mw3-gameplay-x87-32-0x004fcea0
; runtime 0x004fcea0  module mech3demo.exe  orig 0x004fcea0
; entries 8862  guest ops 64  retired 567168  0.52% of window
; TRUNCATED at --max-ops: no terminator within the window

004fcea0  83 ec 3c                     sub dword esp, 0x3c
004fcea3  d9 41 10                     fld dword [ecx+0x10]
004fcea6  d9 41 0c                     fld dword [ecx+0xc]
004fcea9  d8 4a 10                     fmul dword [edx+0x10]
004fceac  d9 41 14                     fld dword [ecx+0x14]
004fceaf  d9 ca                        fxch st(2)
004fceb1  d8 4a 10                     fmul dword [edx+0x10]
004fceb4  d9 41 0c                     fld dword [ecx+0xc]
004fceb7  d9 cb                        fxch st(3)
004fceb9  d8 4a 10                     fmul dword [edx+0x10]
004fcebc  d9 41 10                     fld dword [ecx+0x10]
004fcebf  d9 41 14                     fld dword [ecx+0x14]
004fcec2  d9 01                        fld dword [ecx]
004fcec4  d8 0a                        fmul dword [edx]
004fcec6  d9 5c 24 0c                  fstp dword [esp+0xc]
004fceca  d9 02                        fld dword [edx]
004fcecc  d8 49 04                     fmul dword [ecx+0x4]
004fcecf  d9 5c 24 10                  fstp dword [esp+0x10]
004fced3  d9 02                        fld dword [edx]
004fced5  d8 49 08                     fmul dword [ecx+0x8]
004fced8  d9 5c 24 14                  fstp dword [esp+0x14]
004fcedc  d9 01                        fld dword [ecx]
004fcede  d8 4a 0c                     fmul dword [edx+0xc]
004fcee1  d9 5c 24 18                  fstp dword [esp+0x18]
004fcee5  d9 42 0c                     fld dword [edx+0xc]
004fcee8  d8 49 04                     fmul dword [ecx+0x4]
004fceeb  d9 5c 24 1c                  fstp dword [esp+0x1c]
004fceef  d9 42 0c                     fld dword [edx+0xc]
004fcef2  d8 49 08                     fmul dword [ecx+0x8]
004fcef5  d9 cd                        fxch st(5)
004fcef7  d9 54 24 00                  fst dword [esp+0x0]
004fcefb  d9 cc                        fxch st(4)
004fcefd  d9 54 24 04                  fst dword [esp+0x4]
004fcf01  d9 cb                        fxch st(3)
004fcf03  d9 54 24 08                  fst dword [esp+0x8]
004fcf07  d9 cc                        fxch st(4)
004fcf09  d8 44 24 0c                  fadd dword [esp+0xc]
004fcf0d  d9 5c 24 24                  fstp dword [esp+0x24]
004fcf11  d9 cd                        fxch st(5)
004fcf13  d8 4a 04                     fmul dword [edx+0x4]
004fcf16  d9 44 24 00                  fld dword [esp+0x0]
004fcf1a  d9 cb                        fxch st(3)
004fcf1c  d8 44 24 10                  fadd dword [esp+0x10]
004fcf20  d9 5c 24 28                  fstp dword [esp+0x28]
004fcf24  d9 c9                        fxch st(1)
004fcf26  d8 4a 04                     fmul dword [edx+0x4]
004fcf29  d9 44 24 04                  fld dword [esp+0x4]
004fcf2d  d9 cc                        fxch st(4)
004fcf2f  d8 44 24 14                  fadd dword [esp+0x14]
004fcf33  d9 5c 24 2c                  fstp dword [esp+0x2c]
004fcf37  d9 cd                        fxch st(5)
004fcf39  d8 4a 04                     fmul dword [edx+0x4]
004fcf3c  d9 44 24 08                  fld dword [esp+0x8]
004fcf40  d9 cb                        fxch st(3)
004fcf42  d8 44 24 18                  fadd dword [esp+0x18]
004fcf46  d9 5c 24 30                  fstp dword [esp+0x30]
004fcf4a  d9 c9                        fxch st(1)
004fcf4c  d9 54 24 00                  fst dword [esp+0x0]
004fcf50  d9 44 24 00                  fld dword [esp+0x0]
004fcf54  d9 cc                        fxch st(4)
004fcf56  d8 44 24 1c                  fadd dword [esp+0x1c]
004fcf5a  d9 5c 24 34                  fstp dword [esp+0x34]
004fcf5e  d9 cd                        fxch st(5)
004fcf60  d9 54 24 04                  fst dword [esp+0x4]
