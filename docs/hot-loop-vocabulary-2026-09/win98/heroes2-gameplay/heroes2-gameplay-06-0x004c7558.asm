; heroes2-gameplay-06-0x004c7558
; runtime 0x004c7558  module H2DEMOW.EXE  orig 0x004c7558
; entries 302365  guest ops 10  retired 3023650  2.09% of window

004c7558  a3 7c 5d 52 00               mov [0x525d7c], eax
004c755d  33 c0                        xor eax, eax
004c755f  46                           inc esi
004c7560  8a 46 ff                     mov al, [esi-0x1]
004c7563  89 35 94 5d 52 00            mov [0x525d94], esi
004c7569  4a                           dec edx
004c756a  89 0d 88 5d 52 00            mov [0x525d88], ecx
004c7570  8a 04 08                     mov al, [eax+ecx]
004c7573  88 46 ff                     mov [esi-0x1], al
004c7576  75 e5                        jnz short 0x4c755d
