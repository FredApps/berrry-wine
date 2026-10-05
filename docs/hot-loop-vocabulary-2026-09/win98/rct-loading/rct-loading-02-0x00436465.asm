; rct-loading-02-0x00436465
; runtime 0x00436465  module RCT.exe  orig 0x00436465
; entries 2964023  guest ops 30  retired 88920690  2.53% of window

00436465  c7 05 44 8f 8d 00 ff ff 00 00 mov dword [0x8d8f44], 0xffff
0043646f  c7 05 48 8f 8d 00 ff ff 00 00 mov dword [0x8d8f48], 0xffff
00436479  c7 05 4c 8f 8d 00 ff ff 00 00 mov dword [0x8d8f4c], 0xffff
00436483  c7 05 50 8f 8d 00 ff ff 00 00 mov dword [0x8d8f50], 0xffff
0043648d  c7 05 54 8f 8d 00 ff ff 00 00 mov dword [0x8d8f54], 0xffff
00436497  c7 05 58 8f 8d 00 ff ff 00 00 mov dword [0x8d8f58], 0xffff
004364a1  c7 05 5c 8f 8d 00 ff ff 00 00 mov dword [0x8d8f5c], 0xffff
004364ab  c7 05 60 8f 8d 00 ff ff 00 00 mov dword [0x8d8f60], 0xffff
004364b5  c7 05 64 8f 8d 00 ff ff 00 00 mov dword [0x8d8f64], 0xffff
004364bf  c7 05 68 8f 8d 00 ff ff 00 00 mov dword [0x8d8f68], 0xffff
004364c9  c7 05 6c 8f 8d 00 ff ff 00 00 mov dword [0x8d8f6c], 0xffff
004364d3  66 c7 05 a5 31 8e 00 00 00   mov word [0x8e31a5], 0x0
004364dc  c6 05 da 0f 8e 00 ff         mov byte [0x8e0fda], 0xff
004364e3  c6 05 1c 10 8e 00 ff         mov byte [0x8e101c], 0xff
004364ea  c6 05 5e 10 8e 00 ff         mov byte [0x8e105e], 0xff
004364f1  66 a3 b2 8f 8d 00            mov [0x8d8fb2], ax
004364f7  66 89 0d b6 8f 8d 00         mov [0x8d8fb6], cx
004364fe  66 a3 bc 8f 8d 00            mov [0x8d8fbc], ax
00436504  66 89 0d be 8f 8d 00         mov [0x8d8fbe], cx
0043650b  66 8b d1                     mov dx, cx
0043650e  66 c1 c2 07                  rol dx, 0x7
00436512  66 0b d0                     or dx, ax
00436515  66 c1 ca 05                  ror dx, 0x5
00436519  0f b7 f2                     movzx esi, word edx
0043651c  8b 34 b5 34 8f 8b 00         mov esi, [0x8b8f34+esi*4]
00436523  50                           push eax
00436524  51                           push ecx
00436525  8b 15 c8 8f 8d 00            mov edx, [0x8d8fc8]
0043652b  8b 3d 38 8f 8c 00            mov edi, [0x8c8f38]
00436531  ff 24 95 38 65 43 00         jmp [0x436538+edx*4]
