; mw3long-04-0x004f7aba
; runtime 0x004f7aba  module mech3demo.exe  orig 0x004f7aba
; entries 50470  guest ops 13  retired 656110  0.25% of window

004f7aba  bf 10 00 00 00               mov edi, 0x10
004f7abf  bd 00 01 00 00               mov ebp, 0x100
004f7ac4  b3 80                        mov bl, 0x80
004f7ac6  a1 0c c9 5f 00               mov eax, [0x5fc90c]
004f7acb  8d 54 24 10                  lea edx, [esp+0x10]
004f7acf  6a 00                        push 0x0
004f7ad1  52                           push edx
004f7ad2  8b 15 10 c9 5f 00            mov edx, [0x5fc910]
004f7ad8  8b 08                        mov ecx, [eax]
004f7ada  52                           push edx
004f7adb  57                           push edi
004f7adc  50                           push eax
004f7add  ff 51 28                     call [ecx+0x28]
