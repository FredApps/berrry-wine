; starcraft-loading-07-0x007c48a0
; runtime 0x007c48a0  module storm.dll  orig 0x150288a0
; entries 8331856  guest ops 8  retired 66654848  3.05% of window

150288a0  53                           push ebx
150288a1  56                           push esi
150288a2  8b 74 24 0c                  mov esi, [esp+0xc]
150288a6  57                           push edi
150288a7  8b 5c 24 14                  mov ebx, [esp+0x14]
150288ab  8b 46 18                     mov eax, [esi+0x18]
150288ae  3b c3                        cmp eax, ebx
150288b0  72 10                        jb short 0x150288c2
