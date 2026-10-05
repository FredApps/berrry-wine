; heroes2-loading-05-0x004c7700
; runtime 0x004c7700  module H2DEMOW.EXE  orig 0x004c7700
; entries 249180  guest ops 12  retired 2990160  3.30% of window

004c7700  8b ca                        mov ecx, edx
004c7702  c1 e9 02                     shr ecx, 0x2
004c7705  f3 a5                        rep movsd
004c7707  8b ca                        mov ecx, edx
004c7709  83 e1 03                     and dword ecx, 0x3
004c770c  f3 a4                        rep movsb
004c770e  03 d8                        add ebx, eax
004c7710  8b 0d 80 5d 52 00            mov ecx, [0x525d80]
004c7716  03 c8                        add ecx, eax
004c7718  a3 90 5d 52 00               mov [0x525d90], eax
004c771d  89 0d 80 5d 52 00            mov [0x525d80], ecx
004c7723  e9 19 fc ff ff               jmp 0x4c7341
