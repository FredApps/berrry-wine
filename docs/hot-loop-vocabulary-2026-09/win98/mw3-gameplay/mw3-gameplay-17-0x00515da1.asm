; mw3-gameplay-17-0x00515da1
; runtime 0x00515da1  module mech3demo.exe  orig 0x00515da1
; entries 60504  guest ops 26  retired 1573104  0.84% of window

00515da1  8b 45 bc                     mov eax, [ebp-0x44]
00515da4  8b 3d e4 4b 70 00            mov edi, [0x704be4]
00515daa  c1 e1 03                     shl ecx, 0x3
00515dad  8b 70 10                     mov esi, [eax+0x10]
00515db0  8b d1                        mov edx, ecx
00515db2  c1 e9 02                     shr ecx, 0x2
00515db5  f3 a5                        rep movsd
00515db7  8b ca                        mov ecx, edx
00515db9  83 e1 03                     and dword ecx, 0x3
00515dbc  f3 a4                        rep movsb
00515dbe  8b 55 fc                     mov edx, [ebp-0x4]
00515dc1  8b 70 14                     mov esi, [eax+0x14]
00515dc4  bf 0c 63 70 00               mov edi, 0x70630c
00515dc9  8d 14 52                     lea edx, [edx+edx*2]
00515dcc  c1 e2 02                     shl edx, 0x2
00515dcf  8b ca                        mov ecx, edx
00515dd1  8b c1                        mov eax, ecx
00515dd3  c1 e9 02                     shr ecx, 0x2
00515dd6  f3 a5                        rep movsd
00515dd8  8b c8                        mov ecx, eax
00515dda  8b 45 f4                     mov eax, [ebp-0xc]
00515ddd  83 e1 03                     and dword ecx, 0x3
00515de0  85 c0                        test eax, eax
00515de2  8b 45 dc                     mov eax, [ebp-0x24]
00515de5  f3 a4                        rep movsb
00515de7  0f 84 6a 0c 00 00            jz 0x516a57
