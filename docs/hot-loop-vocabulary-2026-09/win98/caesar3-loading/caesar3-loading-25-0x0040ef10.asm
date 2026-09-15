; caesar3-loading-25-0x0040ef10
; runtime 0x0040ef10  module c3.exe  orig 0x0040ef10
; entries 177856  guest ops 20  retired 3557120  1.04% of window

0040ef10  55                           push ebp
0040ef11  8b ec                        mov ebp, esp
0040ef13  53                           push ebx
0040ef14  56                           push esi
0040ef15  57                           push edi
0040ef16  8b 3d 98 87 52 00            mov edi, [0x528798]
0040ef1c  8b 45 08                     mov eax, [ebp+0x8]
0040ef1f  03 c0                        add eax, eax
0040ef21  03 f8                        add edi, eax
0040ef23  8b 45 0c                     mov eax, [ebp+0xc]
0040ef26  8b 15 2c 09 58 00            mov edx, [0x58092c]
0040ef2c  f7 e2                        mul edx
0040ef2e  03 f8                        add edi, eax
0040ef30  8b 5d 10                     mov ebx, [ebp+0x10]
0040ef33  66 89 1f                     mov [edi], bx
0040ef36  5f                           pop edi
0040ef37  5e                           pop esi
0040ef38  5b                           pop ebx
0040ef39  5d                           pop ebp
0040ef3a  c3                           ret
