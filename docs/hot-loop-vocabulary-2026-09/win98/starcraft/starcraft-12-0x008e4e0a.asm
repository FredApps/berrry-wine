; starcraft-12-0x008e4e0a
; runtime 0x008e4e0a  module smackw32.dll  orig 0x1000ee0a
; entries 501395  guest ops 14  retired 7019530  2.17% of window

1000ee0a  8b 29                        mov ebp, [ecx]
1000ee0c  8b 1d 38 4a 01 10            mov ebx, [0x10014a38]
1000ee12  89 11                        mov [ecx], edx
1000ee14  8b 0d 3c 4a 01 10            mov ecx, [0x10014a3c]
1000ee1a  8b 13                        mov edx, [ebx]
1000ee1c  89 2b                        mov [ebx], ebp
1000ee1e  89 11                        mov [ecx], edx
1000ee20  8b d0                        mov edx, eax
1000ee22  8b c8                        mov ecx, eax
1000ee24  81 e2 fc 00 00 00            and dword edx, 0xfc
1000ee2a  83 e1 03                     and dword ecx, 0x3
1000ee2d  8b 92 e0 4a 01 10            mov edx, [edx+0x10014ae0]
1000ee33  89 15 54 4a 01 10            mov [0x10014a54], edx
1000ee39  ff 24 8d 40 4a 01 10         jmp [0x10014a40+ecx*4]
