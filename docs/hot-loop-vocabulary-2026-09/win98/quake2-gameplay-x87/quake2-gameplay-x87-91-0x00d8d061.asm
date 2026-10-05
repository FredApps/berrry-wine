; quake2-gameplay-x87-91-0x00d8d061
; runtime 0x00d8d061  module ref_soft.dll  orig 0x1000f061
; entries 8154  guest ops 51  retired 415854  0.21% of window

1000f061  d9 46 04                     fld dword [esi+0x4]
1000f064  d9 06                        fld dword [esi]
1000f066  d8 0d 70 85 11 10            fmul dword [0x10118570]
1000f06c  d9 46 08                     fld dword [esi+0x8]
1000f06f  d9 ca                        fxch st(2)
1000f071  d8 0d 74 85 11 10            fmul dword [0x10118574]
1000f077  d9 44 24 24                  fld dword [esp+0x24]
1000f07b  d9 cb                        fxch st(3)
1000f07d  d8 0d 78 85 11 10            fmul dword [0x10118578]
1000f083  d9 c9                        fxch st(1)
1000f085  de c2                        faddp st(2), st
1000f087  8b 0d 90 71 11 10            mov ecx, [0x10117190]
1000f08d  83 c4 08                     add dword esp, 0x8
1000f090  de c1                        faddp st(1), st
1000f092  d8 6e 0c                     fsubr dword [esi+0xc]
1000f095  dc 3d 28 04 02 10            fdivr qword [0x10020428]
1000f09b  d9 c9                        fxch st(1)
1000f09d  d8 c9                        fmul st, st(1)
1000f09f  d8 0d b4 81 0e 10            fmul dword [0x100e81b4]
1000f0a5  d9 59 30                     fstp dword [ecx+0x30]
1000f0a8  d9 44 24 20                  fld dword [esp+0x20]
1000f0ac  8b 15 90 71 11 10            mov edx, [0x10117190]
1000f0b2  d8 c9                        fmul st, st(1)
1000f0b4  d8 0d 60 87 0e 10            fmul dword [0x100e8760]
1000f0ba  d9 e0                        fchs
1000f0bc  d9 5a 34                     fstp dword [edx+0x34]
1000f0bf  a1 90 71 11 10               mov eax, [0x10117190]
1000f0c4  d9 44 24 24                  fld dword [esp+0x24]
1000f0c8  d9 40 30                     fld dword [eax+0x30]
1000f0cb  d9 c9                        fxch st(1)
1000f0cd  d8 ca                        fmul st, st(2)
1000f0cf  d9 40 34                     fld dword [eax+0x34]
1000f0d2  d9 ca                        fxch st(2)
1000f0d4  d8 0d 40 87 0e 10            fmul dword [0x100e8740]
1000f0da  d9 ca                        fxch st(2)
1000f0dc  d8 0d 90 b9 0f 10            fmul dword [0x100fb990]
1000f0e2  d9 ca                        fxch st(2)
1000f0e4  de e9                        fsubp st(1), st
1000f0e6  d9 c9                        fxch st(1)
1000f0e8  de e9                        fsubp st(1), st
1000f0ea  d9 58 2c                     fstp dword [eax+0x2c]
1000f0ed  a1 90 71 11 10               mov eax, [0x10117190]
1000f0f2  83 c0 40                     add dword eax, 0x40
1000f0f5  dd d8                        fstp st(0)
1000f0f7  a3 90 71 11 10               mov [0x10117190], eax
1000f0fc  5f                           pop edi
1000f0fd  5e                           pop esi
1000f0fe  5d                           pop ebp
1000f0ff  5b                           pop ebx
1000f100  83 c4 18                     add dword esp, 0x18
1000f103  c3                           ret
