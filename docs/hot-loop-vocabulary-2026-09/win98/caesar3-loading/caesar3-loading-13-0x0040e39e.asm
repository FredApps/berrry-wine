; caesar3-loading-13-0x0040e39e
; runtime 0x0040e39e  module c3.exe  orig 0x0040e39e
; entries 781116  guest ops 8  retired 6248928  1.83% of window

0040e39e  8b 55 f8                     mov edx, [ebp-0x8]
0040e3a1  83 c2 01                     add dword edx, 0x1
0040e3a4  89 55 f8                     mov [ebp-0x8], edx
0040e3a7  8b 45 fc                     mov eax, [ebp-0x4]
0040e3aa  83 c0 14                     add dword eax, 0x14
0040e3ad  89 45 fc                     mov [ebp-0x4], eax
0040e3b0  83 7d f8 33                  cmp dword [ebp-0x8], 0x33
0040e3b4  7d 31                        jge short 0x40e3e7
