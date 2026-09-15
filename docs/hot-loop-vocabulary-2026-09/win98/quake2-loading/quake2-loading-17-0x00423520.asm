; quake2-loading-17-0x00423520
; runtime 0x00423520  module quake2.exe  orig 0x00423520
; entries 190911  guest ops 14  retired 2672754  0.97% of window

00423520  8b 54 24 04                  mov edx, [esp+0x4]
00423524  53                           push ebx
00423525  56                           push esi
00423526  8b 74 24 10                  mov esi, [esp+0x10]
0042352a  0f be 02                     movsx eax, byte [edx]
0042352d  0f be 0e                     movsx ecx, byte [esi]
00423530  57                           push edi
00423531  8b 7c 24 18                  mov edi, [esp+0x18]
00423535  42                           inc edx
00423536  46                           inc esi
00423537  8b df                        mov ebx, edi
00423539  4f                           dec edi
0042353a  85 db                        test ebx, ebx
0042353c  74 42                        jz short 0x423580
