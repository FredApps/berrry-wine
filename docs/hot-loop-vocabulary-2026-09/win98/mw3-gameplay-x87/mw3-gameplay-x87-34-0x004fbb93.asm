; mw3-gameplay-x87-34-0x004fbb93
; runtime 0x004fbb93  module mech3demo.exe  orig 0x004fbb93
; entries 8281  guest ops 64  retired 529984  0.48% of window
; TRUNCATED at --max-ops: no terminator within the window

004fbb93  8b 0d 50 6f 5b 00            mov ecx, [0x5b6f50]
004fbb99  89 45 f4                     mov [ebp-0xc], eax
004fbb9c  8b 11                        mov edx, [ecx]
004fbb9e  89 55 f8                     mov [ebp-0x8], edx
004fbba1  8b 45 fc                     mov eax, [ebp-0x4]
004fbba4  8b 5d f8                     mov ebx, [ebp-0x8]
004fbba7  8b 4d f4                     mov ecx, [ebp-0xc]
004fbbaa  d9 00                        fld dword [eax]
004fbbac  d9 40 04                     fld dword [eax+0x4]
004fbbaf  d9 40 08                     fld dword [eax+0x8]
004fbbb2  d9 03                        fld dword [ebx]
004fbbb4  d8 cb                        fmul st, st(3)
004fbbb6  d9 43 0c                     fld dword [ebx+0xc]
004fbbb9  d8 cb                        fmul st, st(3)
004fbbbb  d9 43 18                     fld dword [ebx+0x18]
004fbbbe  d8 cb                        fmul st, st(3)
004fbbc0  d9 c9                        fxch st(1)
004fbbc2  de c2                        faddp st(2), st
004fbbc4  d9 43 04                     fld dword [ebx+0x4]
004fbbc7  d8 cd                        fmul st, st(5)
004fbbc9  d9 c9                        fxch st(1)
004fbbcb  de c2                        faddp st(2), st
004fbbcd  d9 43 10                     fld dword [ebx+0x10]
004fbbd0  d8 cc                        fmul st, st(4)
004fbbd2  d9 ca                        fxch st(2)
004fbbd4  d9 19                        fstp dword [ecx]
004fbbd6  de c1                        faddp st(1), st
004fbbd8  d9 43 1c                     fld dword [ebx+0x1c]
004fbbdb  d8 ca                        fmul st, st(2)
004fbbdd  d9 cc                        fxch st(4)
004fbbdf  d8 4b 08                     fmul dword [ebx+0x8]
004fbbe2  d9 cc                        fxch st(4)
004fbbe4  de c1                        faddp st(1), st
004fbbe6  d9 c9                        fxch st(1)
004fbbe8  d8 4b 20                     fmul dword [ebx+0x20]
004fbbeb  d9 ca                        fxch st(2)
004fbbed  d8 4b 14                     fmul dword [ebx+0x14]
004fbbf0  d9 c9                        fxch st(1)
004fbbf2  d9 59 04                     fstp dword [ecx+0x4]
004fbbf5  de c1                        faddp st(1), st
004fbbf7  d9 40 0c                     fld dword [eax+0xc]
004fbbfa  d9 ca                        fxch st(2)
004fbbfc  de c1                        faddp st(1), st
004fbbfe  d9 40 14                     fld dword [eax+0x14]
004fbc01  d9 40 10                     fld dword [eax+0x10]
004fbc04  d9 ca                        fxch st(2)
004fbc06  d9 59 08                     fstp dword [ecx+0x8]
004fbc09  d9 03                        fld dword [ebx]
004fbc0b  d8 cb                        fmul st, st(3)
004fbc0d  d9 43 0c                     fld dword [ebx+0xc]
004fbc10  d8 cb                        fmul st, st(3)
004fbc12  d9 43 18                     fld dword [ebx+0x18]
004fbc15  d8 cb                        fmul st, st(3)
004fbc17  d9 c9                        fxch st(1)
004fbc19  de c2                        faddp st(2), st
004fbc1b  d9 43 04                     fld dword [ebx+0x4]
004fbc1e  d8 cd                        fmul st, st(5)
004fbc20  d9 c9                        fxch st(1)
004fbc22  de c2                        faddp st(2), st
004fbc24  d9 43 10                     fld dword [ebx+0x10]
004fbc27  d8 cc                        fmul st, st(4)
004fbc29  d9 ca                        fxch st(2)
004fbc2b  d9 59 0c                     fstp dword [ecx+0xc]
004fbc2e  de c1                        faddp st(1), st
