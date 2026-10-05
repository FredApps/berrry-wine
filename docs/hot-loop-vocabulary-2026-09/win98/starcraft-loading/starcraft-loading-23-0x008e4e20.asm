; starcraft-loading-23-0x008e4e20
; runtime 0x008e4e20  module smackw32.dll  orig 0x1000ee20
; entries 3550272  guest ops 7  retired 24851904  1.14% of window

1000ee20  8b d0                        mov edx, eax
1000ee22  8b c8                        mov ecx, eax
1000ee24  81 e2 fc 00 00 00            and dword edx, 0xfc
1000ee2a  83 e1 03                     and dword ecx, 0x3
1000ee2d  8b 92 e0 4a 01 10            mov edx, [edx+0x10014ae0]
1000ee33  89 15 54 4a 01 10            mov [0x10014a54], edx
1000ee39  ff 24 8d 40 4a 01 10         jmp [0x10014a40+ecx*4]
