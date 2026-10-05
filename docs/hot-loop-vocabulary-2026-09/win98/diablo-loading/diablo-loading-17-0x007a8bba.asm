; diablo-loading-17-0x007a8bba
; runtime 0x007a8bba  module storm.dll  orig 0x15007bba
; entries 1499261  guest ops 6  retired 8995566  1.52% of window

15007bba  8b 4f 10                     mov ecx, [edi+0x10]
15007bbd  8b c3                        mov eax, ebx
15007bbf  2b c1                        sub eax, ecx
15007bc1  8b 57 08                     mov edx, [edi+0x8]
15007bc4  3b c2                        cmp eax, edx
15007bc6  72 2f                        jb short 0x15007bf7
