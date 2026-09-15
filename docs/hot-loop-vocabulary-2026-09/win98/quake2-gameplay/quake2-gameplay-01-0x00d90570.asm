; quake2-gameplay-01-0x00d90570
; runtime 0x00d90570  module ref_soft.dll  orig 0x10012570
; entries 8359976  guest ops 19  retired 158839544  5.34% of window

10012570  8b c2                        mov eax, edx
10012572  03 d3                        add edx, ebx
10012574  c1 e8 10                     shr eax, 0x10
10012577  8b f2                        mov esi, edx
10012579  03 d3                        add edx, ebx
1001257b  81 e6 00 00 ff ff            and dword esi, 0xffff0000
10012581  0b c6                        or eax, esi
10012583  8b ea                        mov ebp, edx
10012585  89 07                        mov [edi], eax
10012587  03 d3                        add edx, ebx
10012589  c1 ed 10                     shr ebp, 0x10
1001258c  8b f2                        mov esi, edx
1001258e  03 d3                        add edx, ebx
10012590  81 e6 00 00 ff ff            and dword esi, 0xffff0000
10012596  0b ee                        or ebp, esi
10012598  89 6f 04                     mov [edi+0x4], ebp
1001259b  83 c7 08                     add dword edi, 0x8
1001259e  49                           dec ecx
1001259f  75 cf                        jnz short 0x10012570
