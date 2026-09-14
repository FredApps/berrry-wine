; caesar3-08-0x0049e9ca
; runtime 0x0049e9ca  module c3.exe  orig 0x0049e9ca
; entries 1882431  guest ops 6  retired 11294586  3.50% of window

0049e9ca  8b 45 fc                     mov eax, [ebp-0x4]
0049e9cd  83 c0 01                     add dword eax, 0x1
0049e9d0  89 45 fc                     mov [ebp-0x4], eax
0049e9d3  8b 4d fc                     mov ecx, [ebp-0x4]
0049e9d6  3b 4d 10                     cmp ecx, [ebp+0x10]
0049e9d9  7d 12                        jge short 0x49e9ed
