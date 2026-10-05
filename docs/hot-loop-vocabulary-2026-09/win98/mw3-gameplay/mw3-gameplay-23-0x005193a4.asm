; mw3-gameplay-23-0x005193a4
; runtime 0x005193a4  module mech3demo.exe  orig 0x005193a4
; entries 77832  guest ops 16  retired 1245312  0.66% of window

005193a4  8b 16                        mov edx, [esi]
005193a6  48                           dec eax
005193a7  8b 54 82 04                  mov edx, [edx+eax*4+0x4]
005193ab  8d 14 52                     lea edx, [edx+edx*2]
005193ae  8d 0c 91                     lea ecx, [ecx+edx*4]
005193b1  8b d7                        mov edx, edi
005193b3  83 ef 0c                     sub dword edi, 0xc
005193b6  8b 19                        mov ebx, [ecx]
005193b8  89 1a                        mov [edx], ebx
005193ba  8b 59 04                     mov ebx, [ecx+0x4]
005193bd  89 5a 04                     mov [edx+0x4], ebx
005193c0  8b 49 08                     mov ecx, [ecx+0x8]
005193c3  89 4a 08                     mov [edx+0x8], ecx
005193c6  8b 0d dc 40 70 00            mov ecx, [0x7040dc]
005193cc  85 c0                        test eax, eax
005193ce  7d d4                        jge short 0x5193a4
