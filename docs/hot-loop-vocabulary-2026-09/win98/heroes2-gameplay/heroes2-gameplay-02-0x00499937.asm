; heroes2-gameplay-02-0x00499937
; runtime 0x00499937  module H2DEMOW.EXE  orig 0x00499937
; entries 265972  guest ops 24  retired 6383328  4.42% of window

00499937  8b 45 fc                     mov eax, [ebp-0x4]
0049993a  8d 04 40                     lea eax, [eax+eax*2]
0049993d  8b 4d f4                     mov ecx, [ebp-0xc]
00499940  0f be 04 08                  movsx eax, byte [eax+ecx]
00499944  c1 e0 02                     shl eax, 0x2
00499947  8b 4d fc                     mov ecx, [ebp-0x4]
0049994a  88 04 8d 84 80 50 00         mov [0x508084+ecx*4], al
00499951  8b 45 fc                     mov eax, [ebp-0x4]
00499954  8d 04 40                     lea eax, [eax+eax*2]
00499957  8b 4d f4                     mov ecx, [ebp-0xc]
0049995a  0f be 44 08 01               movsx eax, byte [eax+ecx+0x1]
0049995f  c1 e0 02                     shl eax, 0x2
00499962  8b 4d fc                     mov ecx, [ebp-0x4]
00499965  88 04 8d 85 80 50 00         mov [0x508085+ecx*4], al
0049996c  8b 45 fc                     mov eax, [ebp-0x4]
0049996f  8d 04 40                     lea eax, [eax+eax*2]
00499972  8b 4d f4                     mov ecx, [ebp-0xc]
00499975  0f be 44 08 02               movsx eax, byte [eax+ecx+0x2]
0049997a  c1 e0 02                     shl eax, 0x2
0049997d  8b 4d fc                     mov ecx, [ebp-0x4]
00499980  88 04 8d 86 80 50 00         mov [0x508086+ecx*4], al
00499987  8b 45 fc                     mov eax, [ebp-0x4]
0049998a  c6 04 85 87 80 50 00 04      mov byte [0x508087+eax*4], 0x4
00499992  e9 90 ff ff ff               jmp 0x499927
