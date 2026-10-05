; mw3-gameplay-10-0x00547cfe
; runtime 0x00547cfe  module mech3demo.exe  orig 0x00547cfe
; entries 115854  guest ops 18  retired 2085372  1.11% of window

00547cfe  8b 0e                        mov ecx, [esi]
00547d00  83 c6 0c                     add dword esi, 0xc
00547d03  89 48 f8                     mov [eax-0x8], ecx
00547d06  8b 56 f8                     mov edx, [esi-0x8]
00547d09  89 50 fc                     mov [eax-0x4], edx
00547d0c  8b 4e fc                     mov ecx, [esi-0x4]
00547d0f  89 08                        mov [eax], ecx
00547d11  8b 56 fc                     mov edx, [esi-0x4]
00547d14  89 50 04                     mov [eax+0x4], edx
00547d17  8b 0f                        mov ecx, [edi]
00547d19  89 48 10                     mov [eax+0x10], ecx
00547d1c  8b 57 04                     mov edx, [edi+0x4]
00547d1f  89 50 14                     mov [eax+0x14], edx
00547d22  83 e8 20                     sub dword eax, 0x20
00547d25  83 c7 08                     add dword edi, 0x8
00547d28  8d 48 f8                     lea ecx, [eax-0x8]
00547d2b  81 f9 dc 76 7c 00            cmp dword ecx, 0x7c76dc
00547d31  73 cb                        jnb short 0x547cfe
