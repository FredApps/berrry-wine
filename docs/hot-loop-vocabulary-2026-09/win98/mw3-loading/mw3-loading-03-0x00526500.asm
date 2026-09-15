; mw3-loading-03-0x00526500
; runtime 0x00526500  module mech3demo.exe  orig 0x00526500
; entries 1873440  guest ops 15  retired 28101600  2.27% of window

00526500  53                           push ebx
00526501  55                           push ebp
00526502  56                           push esi
00526503  8b 35 28 c6 6e 00            mov esi, [0x6ec628]
00526509  57                           push edi
0052650a  8d 3c 31                     lea edi, [ecx+esi]
0052650d  8b 0d 2c c6 6e 00            mov ecx, [0x6ec62c]
00526513  8d 04 0a                     lea eax, [edx+ecx]
00526516  8b 54 24 14                  mov edx, [esp+0x14]
0052651a  03 d6                        add edx, esi
0052651c  8b 74 24 18                  mov esi, [esp+0x18]
00526520  03 ce                        add ecx, esi
00526522  8b 35 38 c6 6e 00            mov esi, [0x6ec638]
00526528  3b fe                        cmp edi, esi
0052652a  7c 56                        jl short 0x526582
