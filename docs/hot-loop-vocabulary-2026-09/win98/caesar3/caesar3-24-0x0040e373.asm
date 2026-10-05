; caesar3-24-0x0040e373
; runtime 0x0040e373  module c3.exe  orig 0x0040e373
; entries 672180  guest ops 5  retired 3360900  1.04% of window

0040e373  8b 45 f8                     mov eax, [ebp-0x8]
0040e376  83 c0 01                     add dword eax, 0x1
0040e379  89 45 f8                     mov [ebp-0x8], eax
0040e37c  83 7d f8 33                  cmp dword [ebp-0x8], 0x33
0040e380  7d 0c                        jge short 0x40e38e
