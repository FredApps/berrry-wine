; mw3-20-0x005482d8
; runtime 0x005482d8  module mech3demo.exe  orig 0x005482d8
; entries 5375  guest ops 23  retired 123625  1.16% of window

005482d8  8b 0d 68 e8 7b 00            mov ecx, [0x7be868]
005482de  8b d7                        mov edx, edi
005482e0  c1 e0 08                     shl eax, 0x8
005482e3  23 d1                        and edx, ecx
005482e5  8b 0d 74 e8 7b 00            mov ecx, [0x7be874]
005482eb  0b f0                        or esi, eax
005482ed  a1 6c e8 7b 00               mov eax, [0x7be86c]
005482f2  d3 ea                        shr edx, cl
005482f4  8b 0d 78 e8 7b 00            mov ecx, [0x7be878]
005482fa  23 f8                        and edi, eax
005482fc  c1 e6 08                     shl esi, 0x8
005482ff  d3 e7                        shl edi, cl
00548301  0b f2                        or esi, edx
00548303  c1 e6 08                     shl esi, 0x8
00548306  0b f7                        or esi, edi
00548308  5f                           pop edi
00548309  89 35 5c 57 7c 00            mov [0x7c575c], esi
0054830f  89 35 3c 57 7c 00            mov [0x7c573c], esi
00548315  89 35 1c 57 7c 00            mov [0x7c571c], esi
0054831b  89 35 fc 56 7c 00            mov [0x7c56fc], esi
00548321  5e                           pop esi
00548322  83 c4 08                     add dword esp, 0x8
00548325  c2 08 00                     ret 0x8
