; heroes2-loading-17-0x004c5a20
; runtime 0x004c5a20  module H2DEMOW.EXE  orig 0x004c5a20
; entries 108565  guest ops 10  retired 1085650  1.20% of window

004c5a20  83 ec 08                     sub dword esp, 0x8
004c5a23  53                           push ebx
004c5a24  56                           push esi
004c5a25  57                           push edi
004c5a26  8b f1                        mov esi, ecx
004c5a28  66 8b 4e 16                  mov cx, [esi+0x16]
004c5a2c  55                           push ebp
004c5a2d  f6 c1 02                     test cl, 0x2
004c5a30  8b 7c 24 1c                  mov edi, [esp+0x1c]
004c5a34  75 36                        jnz short 0x4c5a6c
