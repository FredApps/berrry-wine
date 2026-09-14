; quake2-04-0x004262c1
; runtime 0x004262c1  module quake2.exe  orig 0x004262c1
; entries 1840674  guest ops 7  retired 12884718  3.51% of window

004262c1  8b 54 24 18                  mov edx, [esp+0x18]
004262c5  8b 4c 24 1c                  mov ecx, [esp+0x1c]
004262c9  8b c3                        mov eax, ebx
004262cb  03 da                        add ebx, edx
004262cd  c1 f8 08                     sar eax, 0x8
004262d0  83 f9 02                     cmp dword ecx, 0x2
004262d3  75 16                        jnz short 0x4262eb
