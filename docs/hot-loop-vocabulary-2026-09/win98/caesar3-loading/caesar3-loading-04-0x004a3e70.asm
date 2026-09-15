; caesar3-loading-04-0x004a3e70
; runtime 0x004a3e70  module c3.exe  orig 0x004a3e70
; entries 2053025  guest ops 11  retired 22583275  6.61% of window

004a3e70  66 8b 06                     mov ax, [esi]
004a3e73  66 8b d8                     mov bx, ax
004a3e76  66 25 e0 7f                  and ax, 0x7fe0
004a3e7a  66 83 e3 1f                  and word bx, 0x1f
004a3e7e  66 d1 e0                     shl ax, 1
004a3e81  66 0b c3                     or ax, bx
004a3e84  66 89 06                     mov [esi], ax
004a3e87  83 c6 02                     add dword esi, 0x2
004a3e8a  83 ea 02                     sub dword edx, 0x2
004a3e8d  80 e9 01                     sub byte cl, 0x1
004a3e90  eb d9                        jmp short 0x4a3e6b
