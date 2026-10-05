; caesar3-17-0x004171b9
; runtime 0x004171b9  module c3.exe  orig 0x004171b9
; entries 909351  guest ops 5  retired 4546755  1.41% of window

004171b9  8b 45 f8                     mov eax, [ebp-0x8]
004171bc  83 c0 01                     add dword eax, 0x1
004171bf  89 45 f8                     mov [ebp-0x8], eax
004171c2  83 7d f8 46                  cmp dword [ebp-0x8], 0x46
004171c6  0f 8d cd 00 00 00            jge 0x417299
