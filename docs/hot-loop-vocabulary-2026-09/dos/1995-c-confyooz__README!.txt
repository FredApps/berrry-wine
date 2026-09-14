; 1995-c-confyooz__README! -- 40 hot blocks, sorted by cs:ip
; window retired 15545 guest ops

; 1000:13c  rank 5  16-bit, 1 entries, 7 retired ops, longest run 4, 3 live-out reg(s)  0.05%

      0x100000c          1  cld                                                   [flags]
      0x1000010          1  mov_ri16                 0x5 0x15c                    [fold]
      0x100001c          1  mov_rm16                 0x526 0x0                    [fold]
      0x1000028          1  mov_rm16                 0x426 0x2                    [fold]
      0x1000034          1  mov_rm16                 0x326 0x4                    [fold]
      0x1000040          1  mov_ri8                  0x4 0x4a                     [partial-reg]
      0x100004c          1  int_imm                  0x21 0x14f 0x14d             [int]

; (no static view: 1000:13c is outside the 1MB real-mode image)

; 1000:14f  rank 6  16-bit, 1 entries, 4 retired ops, longest run 2, 2 live-out reg(s)  0.03%

      0x100005c          1  mov_acc_moffs16          0x2c 0x3                     [fold]
      0x1000068          1  mov_mr16                 0x26 0x1a                    [fold]
      0x1000074          1  mov_rm16                 0x326 0x0                    [fold]
      0x1000080          1  jmp_r16                  0x3                          [branch]

; (no static view: 1000:14f is outside the 1MB real-mode image)

; 1000:15e  rank 1  16-bit, 2212 entries, 8848 retired ops, longest run 1, 2 live-out reg(s)  56.92%

      0x1000738       2212  mov_rm8                  0x234 0x0                    [partial-reg]
      0x1000744       2212  inc_r16_nf               0x6                          [fold]
      0x100074c       2212  or_rr8_jz_t              0x22 0x100077c 0x16b 0x165   [partial-reg+branch]  = or_rr8 + jz

; (no static view: 1000:15e is outside the 1MB real-mode image)

; 1000:15e  rank 7  16-bit, 1 entries, 4 retired ops, longest run 1, 2 live-out reg(s)  0.03%

      0x10006e4          1  mov_rm8                  0x234 0x0                    [partial-reg]
      0x10006f0          1  inc_r16_nf               0x6                          [fold]
      0x10006f8          1  or_rr8_jz_t              0x22 0x1000728 0x16b 0x165   [partial-reg+branch]  = or_rr8 + jz

; (no static view: 1000:15e is outside the 1MB real-mode image)

; 1000:165  rank 2  16-bit, 2172 entries, 4344 retired ops, longest run 0, 1 live-out reg(s)  27.94%

      0x1000760       2172  mov_ri8                  0x4 0x2                      [partial-reg]
      0x100076c       2172  int_imm                  0x21 0x169 0x167             [int]

; (no static view: 1000:165 is outside the 1MB real-mode image)

; 1000:169  rank 3  16-bit, 2173 entries, 2173 retired ops, longest run 0, 0 live-out reg(s)  13.98%

      0x100072c       2173  jmp                      0x1000738 0x15e              [branch]

; (no static view: 1000:169 is outside the 1MB real-mode image)

; 1000:16b  rank 4  16-bit, 40 entries, 40 retired ops, longest run 0, 0 live-out reg(s)  0.26%

      0x100077c         40  ret                                                   [ret]

; (no static view: 1000:16b is outside the 1MB real-mode image)

; 1000:a31  rank 8  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000088          1  lea                      0x626 0x20                   [fold]
      0x1000094          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10000a0          1  call_r16                 0x0 0xa3a 0x10000b0          [call]

; (no static view: 1000:a31 is outside the 1MB real-mode image)

; 1000:a3a  rank 9  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10000b0          1  lea                      0x626 0x63                   [fold]
      0x10000bc          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10000c8          1  call_r16                 0x0 0xa43 0x10000d8          [call]

; (no static view: 1000:a3a is outside the 1MB real-mode image)

; 1000:a43  rank 10  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10000d8          1  lea                      0x626 0x73                   [fold]
      0x10000e4          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10000f0          1  call_r16                 0x0 0xa4c 0x1000100          [call]

; (no static view: 1000:a43 is outside the 1MB real-mode image)

; 1000:a4c  rank 11  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000100          1  lea                      0x626 0xb6                   [fold]
      0x100010c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000118          1  call_r16                 0x0 0xa55 0x1000128          [call]

; (no static view: 1000:a4c is outside the 1MB real-mode image)

; 1000:a55  rank 12  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000128          1  lea                      0x626 0xec                   [fold]
      0x1000134          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000140          1  call_r16                 0x0 0xa5e 0x1000150          [call]

; (no static view: 1000:a55 is outside the 1MB real-mode image)

; 1000:a5e  rank 13  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000150          1  lea                      0x626 0x133                  [fold]
      0x100015c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000168          1  call_r16                 0x0 0xa67 0x1000178          [call]

; (no static view: 1000:a5e is outside the 1MB real-mode image)

; 1000:a67  rank 14  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000178          1  lea                      0x626 0x167                  [fold]
      0x1000184          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000190          1  call_r16                 0x0 0xa70 0x10001a0          [call]

; (no static view: 1000:a67 is outside the 1MB real-mode image)

; 1000:a70  rank 15  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10001a0          1  lea                      0x626 0x1b0                  [fold]
      0x10001ac          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10001b8          1  call_r16                 0x0 0xa79 0x10001c8          [call]

; (no static view: 1000:a70 is outside the 1MB real-mode image)

; 1000:a79  rank 16  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10001c8          1  lea                      0x626 0x1d0                  [fold]
      0x10001d4          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10001e0          1  call_r16                 0x0 0xa82 0x10001f0          [call]

; (no static view: 1000:a79 is outside the 1MB real-mode image)

; 1000:a82  rank 17  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10001f0          1  lea                      0x626 0x219                  [fold]
      0x10001fc          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000208          1  call_r16                 0x0 0xa8b 0x1000218          [call]

; (no static view: 1000:a82 is outside the 1MB real-mode image)

; 1000:a8b  rank 18  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000218          1  lea                      0x626 0x239                  [fold]
      0x1000224          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000230          1  call_r16                 0x0 0xa94 0x1000240          [call]

; (no static view: 1000:a8b is outside the 1MB real-mode image)

; 1000:a94  rank 19  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000240          1  lea                      0x626 0x282                  [fold]
      0x100024c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000258          1  call_r16                 0x0 0xa9d 0x1000268          [call]

; (no static view: 1000:a94 is outside the 1MB real-mode image)

; 1000:a9d  rank 20  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000268          1  lea                      0x626 0x2b0                  [fold]
      0x1000274          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000280          1  call_r16                 0x0 0xaa6 0x1000290          [call]

; (no static view: 1000:a9d is outside the 1MB real-mode image)

; 1000:aa6  rank 21  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000290          1  lea                      0x626 0x2f9                  [fold]
      0x100029c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10002a8          1  call_r16                 0x0 0xaaf 0x10002b8          [call]

; (no static view: 1000:aa6 is outside the 1MB real-mode image)

; 1000:aaf  rank 22  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10002b8          1  lea                      0x626 0x325                  [fold]
      0x10002c4          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10002d0          1  call_r16                 0x0 0xab8 0x10002e0          [call]

; (no static view: 1000:aaf is outside the 1MB real-mode image)

; 1000:ab8  rank 23  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10002e0          1  lea                      0x626 0x36e                  [fold]
      0x10002ec          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10002f8          1  call_r16                 0x0 0xac1 0x1000308          [call]

; (no static view: 1000:ab8 is outside the 1MB real-mode image)

; 1000:ac1  rank 24  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000308          1  lea                      0x626 0x39c                  [fold]
      0x1000314          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000320          1  call_r16                 0x0 0xaca 0x1000330          [call]

; (no static view: 1000:ac1 is outside the 1MB real-mode image)

; 1000:aca  rank 25  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000330          1  lea                      0x626 0x3e5                  [fold]
      0x100033c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000348          1  call_r16                 0x0 0xad3 0x1000358          [call]

; (no static view: 1000:aca is outside the 1MB real-mode image)

; 1000:ad3  rank 26  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000358          1  lea                      0x626 0x413                  [fold]
      0x1000364          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000370          1  call_r16                 0x0 0xadc 0x1000380          [call]

; (no static view: 1000:ad3 is outside the 1MB real-mode image)

; 1000:adc  rank 27  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000380          1  lea                      0x626 0x45c                  [fold]
      0x100038c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000398          1  call_r16                 0x0 0xae5 0x10003a8          [call]

; (no static view: 1000:adc is outside the 1MB real-mode image)

; 1000:ae5  rank 28  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10003a8          1  lea                      0x626 0x481                  [fold]
      0x10003b4          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10003c0          1  call_r16                 0x0 0xaee 0x10003d0          [call]

; (no static view: 1000:ae5 is outside the 1MB real-mode image)

; 1000:aee  rank 29  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10003d0          1  lea                      0x626 0x4ca                  [fold]
      0x10003dc          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10003e8          1  call_r16                 0x0 0xaf7 0x10003f8          [call]

; (no static view: 1000:aee is outside the 1MB real-mode image)

; 1000:af7  rank 30  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10003f8          1  lea                      0x626 0x4f8                  [fold]
      0x1000404          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000410          1  call_r16                 0x0 0xb00 0x1000420          [call]

; (no static view: 1000:af7 is outside the 1MB real-mode image)

; 1000:b00  rank 31  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000420          1  lea                      0x626 0x539                  [fold]
      0x100042c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000438          1  call_r16                 0x0 0xb09 0x1000448          [call]

; (no static view: 1000:b00 is outside the 1MB real-mode image)

; 1000:b09  rank 32  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000448          1  lea                      0x626 0x582                  [fold]
      0x1000454          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000460          1  call_r16                 0x0 0xb12 0x1000470          [call]

; (no static view: 1000:b09 is outside the 1MB real-mode image)

; 1000:b12  rank 33  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000470          1  lea                      0x626 0x5cb                  [fold]
      0x100047c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000488          1  call_r16                 0x0 0xb1b 0x1000498          [call]

; (no static view: 1000:b12 is outside the 1MB real-mode image)

; 1000:b1b  rank 34  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000498          1  lea                      0x626 0x5e4                  [fold]
      0x10004a4          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10004b0          1  call_r16                 0x0 0xb24 0x10004c0          [call]

; (no static view: 1000:b1b is outside the 1MB real-mode image)

; 1000:b24  rank 35  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10004c0          1  lea                      0x626 0x62d                  [fold]
      0x10004cc          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10004d8          1  call_r16                 0x0 0xb2d 0x10004e8          [call]

; (no static view: 1000:b24 is outside the 1MB real-mode image)

; 1000:b2d  rank 36  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x10004e8          1  lea                      0x626 0x653                  [fold]
      0x10004f4          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000500          1  call_r16                 0x0 0xb36 0x1000510          [call]

; (no static view: 1000:b2d is outside the 1MB real-mode image)

; 1000:b36  rank 37  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000510          1  lea                      0x626 0x69c                  [fold]
      0x100051c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000528          1  call_r16                 0x0 0xb3f 0x1000538          [call]

; (no static view: 1000:b36 is outside the 1MB real-mode image)

; 1000:b3f  rank 38  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000538          1  lea                      0x626 0x6ab                  [fold]
      0x1000544          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000550          1  call_r16                 0x0 0xb48 0x1000560          [call]

; (no static view: 1000:b3f is outside the 1MB real-mode image)

; 1000:b48  rank 39  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000560          1  lea                      0x626 0x6f1                  [fold]
      0x100056c          1  mov_ri16                 0x0 0x15e                    [fold]
      0x1000578          1  call_r16                 0x0 0xb51 0x1000588          [call]

; (no static view: 1000:b48 is outside the 1MB real-mode image)

; 1000:b51  rank 40  16-bit, 1 entries, 3 retired ops, longest run 2, 2 live-out reg(s)  0.02%

      0x1000588          1  lea                      0x626 0x73a                  [fold]
      0x1000594          1  mov_ri16                 0x0 0x15e                    [fold]
      0x10005a0          1  call_r16                 0x0 0xb5a 0x10005b0          [call]

; (no static view: 1000:b51 is outside the 1MB real-mode image)

