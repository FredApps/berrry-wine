; gta2-loading-24-0x00405275
; runtime 0x00405275  module gta2.exe  orig 0x00405275
; entries 1439  guest ops 9  retired 12951  0.22% of window

00405275  db 44 24 08                  fild dword [esp+0x8]
00405279  dc 0d a8 03 5f 00            fmul qword [0x5f03a8]
0040527f  dc 0d b8 03 5f 00            fmul qword [0x5f03b8]
00405285  d9 f2                        fptan
00405287  d9 c9                        fxch st(1)
00405289  dc 0d c0 03 5f 00            fmul qword [0x5f03c0]
0040528f  d9 c9                        fxch st(1)
00405291  dd d8                        fstp st(0)
00405293  e8 a8 98 1d 00               call 0x5deb40
