; caesar3-21-0x004172db
; runtime 0x004172db  module c3.exe  orig 0x004172db
; entries 909351  guest ops 4  retired 3637404  1.13% of window

004172db  8b 4d f8                     mov ecx, [ebp-0x8]
004172de  c1 e1 07                     shl ecx, 0x7
004172e1  83 b9 b8 64 86 00 00         cmp dword [ecx+0x8664b8], 0x0
004172e8  7f 02                        jg short 0x4172ec
