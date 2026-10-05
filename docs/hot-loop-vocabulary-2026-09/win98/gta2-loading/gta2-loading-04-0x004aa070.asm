; gta2-loading-04-0x004aa070
; runtime 0x004aa070  module gta2.exe  orig 0x004aa070
; entries 12353  guest ops 17  retired 210001  3.64% of window

004aa070  83 ec 0c                     sub dword esp, 0xc
004aa073  53                           push ebx
004aa074  55                           push ebp
004aa075  56                           push esi
004aa076  8b f1                        mov esi, ecx
004aa078  33 c0                        xor eax, eax
004aa07a  57                           push edi
004aa07b  66 8b 86 1e 01 00 00         mov ax, [esi+0x11e]
004aa082  8b c8                        mov ecx, eax
004aa084  c1 e1 06                     shl ecx, 0x6
004aa087  2b c8                        sub ecx, eax
004aa089  c1 e1 04                     shl ecx, 0x4
004aa08c  03 c8                        add ecx, eax
004aa08e  8d 9c 4e 22 01 00 00         lea ebx, [esi+ecx*2+0x122]
004aa095  8b ce                        mov ecx, esi
004aa097  89 5c 24 10                  mov [esp+0x10], ebx
004aa09b  e8 20 3a 00 00               call 0x4adac0
