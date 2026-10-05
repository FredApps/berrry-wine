; heroes2-gameplay-17-0x004c7521
; runtime 0x004c7521  module H2DEMOW.EXE  orig 0x004c7521
; entries 302365  guest ops 6  retired 1814190  1.26% of window

004c7521  83 e0 3c                     and dword eax, 0x3c
004c7524  8b 74 24 20                  mov esi, [esp+0x20]
004c7528  c1 e0 06                     shl eax, 0x6
004c752b  85 f6                        test esi, esi
004c752d  8d 88 48 93 4e 00            lea ecx, [eax+0x4e9348]
004c7533  75 48                        jnz short 0x4c757d
