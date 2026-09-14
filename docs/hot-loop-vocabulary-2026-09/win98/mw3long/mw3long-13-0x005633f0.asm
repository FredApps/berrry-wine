; mw3long-13-0x005633f0
; runtime 0x005633f0  module mech3demo.exe  orig 0x005633f0
; entries 50470  guest ops 7  retired 353290  0.13% of window

005633f0  53                           push ebx
005633f1  56                           push esi
005633f2  8b f1                        mov esi, ecx
005633f4  57                           push edi
005633f5  8b 46 18                     mov eax, [esi+0x18]
005633f8  85 c0                        test eax, eax
005633fa  75 08                        jnz short 0x563404
