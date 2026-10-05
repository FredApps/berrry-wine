; mw3-19-0x004f7b04
; runtime 0x004f7b04  module mech3demo.exe  orig 0x004f7b04
; entries 26636  guest ops 5  retired 133180  1.25% of window

004f7b04  8b 44 24 10                  mov eax, [esp+0x10]
004f7b08  8b 0d 10 c9 5f 00            mov ecx, [0x5fc910]
004f7b0e  33 d2                        xor edx, edx
004f7b10  85 c0                        test eax, eax
004f7b12  0f 86 e2 00 00 00            jbe 0x4f7bfa
