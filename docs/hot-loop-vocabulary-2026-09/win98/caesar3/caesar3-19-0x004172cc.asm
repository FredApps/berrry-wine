; caesar3-19-0x004172cc
; runtime 0x004172cc  module c3.exe  orig 0x004172cc
; entries 909351  guest ops 5  retired 4546755  1.41% of window

004172cc  8b 45 f8                     mov eax, [ebp-0x8]
004172cf  83 c0 01                     add dword eax, 0x1
004172d2  89 45 f8                     mov [ebp-0x8], eax
004172d5  83 7d f8 46                  cmp dword [ebp-0x8], 0x46
004172d9  7d 3b                        jge short 0x417316
