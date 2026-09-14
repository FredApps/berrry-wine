; caesar3-07-0x0049e9db
; runtime 0x0049e9db  module c3.exe  orig 0x0049e9db
; entries 1882431  guest ops 7  retired 13177017  4.08% of window

0049e9db  8b 55 0c                     mov edx, [ebp+0xc]
0049e9de  03 55 fc                     add edx, [ebp-0x4]
0049e9e1  8b 45 08                     mov eax, [ebp+0x8]
0049e9e4  03 45 fc                     add eax, [ebp-0x4]
0049e9e7  8a 08                        mov cl, [eax]
0049e9e9  88 0a                        mov [edx], cl
0049e9eb  eb dd                        jmp short 0x49e9ca
