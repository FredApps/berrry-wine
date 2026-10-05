; quake2-gameplay-x87-09-0x00d92590
; runtime 0x00d92590  module ref_soft.dll  orig 0x10014590
; entries 182194  guest ops 16  retired 2915104  1.48% of window

10014590  55                           push ebp
10014591  8b ec                        mov ebp, esp
10014593  83 c4 f4                     add dword esp, -0xc
10014596  9b                           db 0x9b
10014597  d9 7d fe                     fnstcw dword [ebp-0x2]
1001459a  9b                           db 0x9b
1001459b  66 8b 45 fe                  mov ax, [ebp-0x2]
1001459f  80 cc 0c                     or byte ah, 0xc
100145a2  66 89 45 fc                  mov [ebp-0x4], ax
100145a6  d9 6d fc                     fldcw dword [ebp-0x4]
100145a9  df 7d f4                     fistp word [ebp-0xc]
100145ac  d9 6d fe                     fldcw dword [ebp-0x2]
100145af  8b 45 f4                     mov eax, [ebp-0xc]
100145b2  8b 55 f8                     mov edx, [ebp-0x8]
100145b5  c9                           leave
100145b6  c3                           ret
