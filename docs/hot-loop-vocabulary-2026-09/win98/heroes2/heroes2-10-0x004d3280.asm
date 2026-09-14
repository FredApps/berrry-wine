; heroes2-10-0x004d3280
; runtime 0x004d3280  module H2DEMOW.EXE  orig 0x004d3280
; entries 172997  guest ops 9  retired 1556973  2.31% of window

004d3280  53                           push ebx
004d3281  56                           push esi
004d3282  57                           push edi
004d3283  8b f1                        mov esi, ecx
004d3285  8b 4c 24 10                  mov ecx, [esp+0x10]
004d3289  55                           push ebp
004d328a  8b 01                        mov eax, [ecx]
004d328c  83 f8 04                     cmp dword eax, 0x4
004d328f  74 10                        jz short 0x4d32a1
