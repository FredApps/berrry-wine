; starcraft-loading-24-0x007acf0a
; runtime 0x007acf0a  module storm.dll  orig 0x15010f0a
; entries 1067075  guest ops 23  retired 24542725  1.12% of window

15010f0a  8b 1d 7c d3 02 15            mov ebx, [0x1502d37c]
15010f10  8b f2                        mov esi, edx
15010f12  81 e6 ff 00 00 00            and dword esi, 0xff
15010f18  83 c1 04                     add dword ecx, 0x4
15010f1b  8b ac b3 00 10 00 00         mov ebp, [ebx+esi*4+0x1000]
15010f22  8b 59 fc                     mov ebx, [ecx-0x4]
15010f25  03 c5                        add eax, ebp
15010f27  8d 34 10                     lea esi, [eax+edx]
15010f2a  33 de                        xor ebx, esi
15010f2c  89 59 fc                     mov [ecx-0x4], ebx
15010f2f  8b f3                        mov esi, ebx
15010f31  8b d8                        mov ebx, eax
15010f33  c1 e3 05                     shl ebx, 0x5
15010f36  03 f3                        add esi, ebx
15010f38  8d 44 30 03                  lea eax, [eax+esi+0x3]
15010f3c  8b f2                        mov esi, edx
15010f3e  81 f2 ff 07 00 00            xor dword edx, 0x7ff
15010f44  c1 e2 15                     shl edx, 0x15
15010f47  c1 ee 0b                     shr esi, 0xb
15010f4a  81 c2 11 11 11 11            add dword edx, 0x11111111
15010f50  0b d6                        or edx, esi
15010f52  4f                           dec edi
15010f53  75 b5                        jnz short 0x15010f0a
