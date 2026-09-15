; quake2-loading-21-0x00d83822
; runtime 0x00d83822  module ref_soft.dll  orig 0x10005822
; entries 209402  guest ops 7  retired 1465814  0.53% of window

10005822  8b c8                        mov ecx, eax
10005824  33 c0                        xor eax, eax
10005826  8a 02                        mov al, [edx]
10005828  83 e1 3f                     and dword ecx, 0x3f
1000582b  42                           inc edx
1000582c  89 54 24 10                  mov [esp+0x10], edx
10005830  eb 05                        jmp short 0x10005837
