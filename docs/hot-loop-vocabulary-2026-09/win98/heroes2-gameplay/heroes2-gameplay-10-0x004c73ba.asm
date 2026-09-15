; heroes2-gameplay-10-0x004c73ba
; runtime 0x004c73ba  module H2DEMOW.EXE  orig 0x004c73ba
; entries 302365  guest ops 8  retired 2418920  1.67% of window

004c73ba  33 c0                        xor eax, eax
004c73bc  8b 0d 80 5d 52 00            mov ecx, [0x525d80]
004c73c2  41                           inc ecx
004c73c3  89 0d 80 5d 52 00            mov [0x525d80], ecx
004c73c9  8a 41 ff                     mov al, [ecx-0x1]
004c73cc  8b d0                        mov edx, eax
004c73ce  83 e2 03                     and dword edx, 0x3
004c73d1  75 13                        jnz short 0x4c73e6
