; mw3-04-0x00563432
; runtime 0x00563432  module mech3demo.exe  orig 0x00563432
; entries 26636  guest ops 10  retired 266360  2.49% of window

00563432  dd 44 24 10                  fld qword [esp+0x10]
00563436  dc 66 08                     fsub qword [esi+0x8]
00563439  8b 4e 18                     mov ecx, [esi+0x18]
0056343c  8b 11                        mov edx, [ecx]
0056343e  dd 5c 24 10                  fstp qword [esp+0x10]
00563442  8b 7c 24 14                  mov edi, [esp+0x14]
00563446  8b 5c 24 10                  mov ebx, [esp+0x10]
0056344a  57                           push edi
0056344b  53                           push ebx
0056344c  ff 52 04                     call [edx+0x4]
