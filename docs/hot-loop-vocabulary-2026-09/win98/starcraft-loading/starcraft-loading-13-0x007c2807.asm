; starcraft-loading-13-0x007c2807
; runtime 0x007c2807  module storm.dll  orig 0x15026807
; entries 3342510  guest ops 16  retired 53480160  2.44% of window

15026807  8b 45 04                     mov eax, [ebp+0x4]
1502680a  25 ff 00 00 00               and eax, 0xff
1502680f  c1 e0 02                     shl eax, 0x2
15026812  8b 8c 04 4c 08 00 00         mov ecx, [esp+eax+0x84c]
15026819  8b 9c 04 4c 04 00 00         mov ebx, [esp+eax+0x44c]
15026820  8b 44 04 4c                  mov eax, [esp+eax+0x4c]
15026824  2b cf                        sub ecx, edi
15026826  2b de                        sub ebx, esi
15026828  2b c2                        sub eax, edx
1502682a  8b 09                        mov ecx, [ecx]
1502682c  03 0b                        add ecx, [ebx]
1502682e  8b 18                        mov ebx, [eax]
15026830  8b 44 24 14                  mov eax, [esp+0x14]
15026834  03 cb                        add ecx, ebx
15026836  3b c8                        cmp ecx, eax
15026838  73 0b                        jnb short 0x15026845
