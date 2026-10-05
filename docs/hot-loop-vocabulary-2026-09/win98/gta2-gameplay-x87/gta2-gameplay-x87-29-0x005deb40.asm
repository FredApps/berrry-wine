; gta2-gameplay-x87-29-0x005deb40
; runtime 0x005deb40  module gta2.exe  orig 0x005deb40
; entries 4629  guest ops 16  retired 74064  0.75% of window

005deb40  55                           push ebp
005deb41  8b ec                        mov ebp, esp
005deb43  83 c4 f4                     add dword esp, -0xc
005deb46  9b                           db 0x9b
005deb47  d9 7d fe                     fnstcw dword [ebp-0x2]
005deb4a  9b                           db 0x9b
005deb4b  66 8b 45 fe                  mov ax, [ebp-0x2]
005deb4f  80 cc 0c                     or byte ah, 0xc
005deb52  66 89 45 fc                  mov [ebp-0x4], ax
005deb56  d9 6d fc                     fldcw dword [ebp-0x4]
005deb59  df 7d f4                     fistp word [ebp-0xc]
005deb5c  d9 6d fe                     fldcw dword [ebp-0x2]
005deb5f  8b 45 f4                     mov eax, [ebp-0xc]
005deb62  8b 55 f8                     mov edx, [ebp-0x8]
005deb65  c9                           leave
005deb66  c3                           ret
