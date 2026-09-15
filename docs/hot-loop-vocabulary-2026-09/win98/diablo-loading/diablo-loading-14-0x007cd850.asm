; diablo-loading-14-0x007cd850
; runtime 0x007cd850  module storm.dll  orig 0x1502c850
; entries 1281704  guest ops 8  retired 10253632  1.73% of window

1502c850  53                           push ebx
1502c851  56                           push esi
1502c852  8b 41 18                     mov eax, [ecx+0x18]
1502c855  57                           push edi
1502c856  3b c2                        cmp eax, edx
1502c858  8b da                        mov ebx, edx
1502c85a  8b f1                        mov esi, ecx
1502c85c  72 10                        jb short 0x1502c86e
