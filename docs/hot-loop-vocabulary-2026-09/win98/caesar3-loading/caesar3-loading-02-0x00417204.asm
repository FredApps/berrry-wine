; caesar3-loading-02-0x00417204
; runtime 0x00417204  module c3.exe  orig 0x00417204
; entries 5283684  guest ops 5  retired 26418420  7.73% of window

00417204  8b 4d f0                     mov ecx, [ebp-0x10]
00417207  83 c1 01                     add dword ecx, 0x1
0041720a  89 4d f0                     mov [ebp-0x10], ecx
0041720d  83 7d f0 05                  cmp dword [ebp-0x10], 0x5
00417211  7d 16                        jge short 0x417229
