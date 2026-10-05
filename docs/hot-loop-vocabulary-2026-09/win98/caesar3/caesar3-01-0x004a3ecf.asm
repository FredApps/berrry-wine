; caesar3-01-0x004a3ecf
; runtime 0x004a3ecf  module c3.exe  orig 0x004a3ecf
; entries 5582166  guest ops 9  retired 50239494  15.57% of window

004a3ecf  66 8b d8                     mov bx, ax
004a3ed2  66 25 e0 ff                  and ax, 0xffe0
004a3ed6  66 83 e3 1f                  and word bx, 0x1f
004a3eda  66 d1 e0                     shl ax, 1
004a3edd  66 0b c3                     or ax, bx
004a3ee0  66 89 06                     mov [esi], ax
004a3ee3  83 c6 02                     add dword esi, 0x2
004a3ee6  83 ea 02                     sub dword edx, 0x2
004a3ee9  eb d1                        jmp short 0x4a3ebc
