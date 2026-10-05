; caesar3-20-0x004a7e77
; runtime 0x004a7e77  module c3.exe  orig 0x004a7e77
; entries 900000  guest ops 5  retired 4500000  1.40% of window

004a7e77  8b 55 f4                     mov edx, [ebp-0xc]
004a7e7a  83 c2 01                     add dword edx, 0x1
004a7e7d  89 55 f4                     mov [ebp-0xc], edx
004a7e80  81 7d f4 10 27 00 00         cmp dword [ebp-0xc], 0x2710
004a7e87  7d 0b                        jge short 0x4a7e94
