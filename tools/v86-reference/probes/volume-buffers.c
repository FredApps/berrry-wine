#include <windows.h>

/* Native-only oracle: physical buffers stay large while advertised capacities
   vary. Hex dumps retain terminators, partial writes and untouched sentinels. */
unsigned long _tls_index = 0;
static HANDLE serial;
static BYTE label[160], filesystem[160];
static const DWORD capacities[] = {0, 1, 2, 3, 4, 5, 8, 16, 64};
static void emit(const char *s) {
  DWORD written;
  WriteFile(serial, s, lstrlenA(s), &written, NULL);
}
static void number(DWORD n) {
  char buf[16]; int i = 15;
  buf[i] = 0;
  do { buf[--i] = '0' + n % 10; n /= 10; } while (n);
  emit(buf + i);
}
static void hex(const BYTE *p) {
  static const char digits[] = "0123456789abcdef";
  char buf[65]; int i;
  for (i = 0; i < 32; i++) {
    buf[i * 2] = digits[p[i] >> 4]; buf[i * 2 + 1] = digits[p[i] & 15];
  }
  buf[64] = 0; emit(buf);
}
static void probe(DWORD drive, DWORD wide, DWORD which, DWORD cap, DWORD nulls) {
  char rootA[] = "C:\\";
  WCHAR rootW[] = {'C', ':', '\\', 0};
  DWORD i, ok, error, serialOut = 0xcccccccc, maxOut = 0xcccccccc, flagsOut = 0xcccccccc;
  DWORD labelCap = which == 0 ? cap : 64, fsCap = which == 1 ? cap : 64;
  rootA[0] += drive; rootW[0] += drive;
  for (i = 0; i < sizeof(label); i++) {label[i] = 0xcc; filesystem[i] = 0xcc;}
  SetLastError(0x1234);
  if (wide) ok = GetVolumeInformationW(rootW, nulls & 1 ? NULL : (LPWSTR)label,
    labelCap, &serialOut, &maxOut, &flagsOut,
    nulls & 2 ? NULL : (LPWSTR)filesystem, fsCap);
  else ok = GetVolumeInformationA(rootA, nulls & 1 ? NULL : (LPSTR)label,
    labelCap, &serialOut, &maxOut, &flagsOut,
    nulls & 2 ? NULL : (LPSTR)filesystem, fsCap);
  error = GetLastError();
  emit("VOL drive="); number(drive); emit(" wide="); number(wide);
  emit(" which="); number(which); emit(" cap="); number(cap);
  emit(" nulls="); number(nulls); emit(" result="); number(ok);
  emit(" error="); number(error); emit(" serial="); number(serialOut);
  emit(" max="); number(maxOut); emit(" flags="); number(flagsOut);
  emit(" label="); hex(label); emit(" fs="); hex(filesystem); emit("\r\n");
}
void WinMainCRTStartup(void) {
  DWORD drive, wide, which, i;
  serial = CreateFileA("COM1", GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (serial == INVALID_HANDLE_VALUE) ExitProcess(1);
  emit("VOLUME_BUFFERS_BEGIN version="); number(GetVersion()); emit("\r\n");
  for (drive = 0; drive < 2; drive++) for (wide = 0; wide < 2; wide++) {
    for (which = 0; which < 2; which++) {
      for (i = 0; i < sizeof(capacities) / sizeof(capacities[0]); i++)
        probe(drive, wide, which, capacities[i], 0);
      probe(drive, wide, which, 0, which == 0 ? 1 : 2);
    }
    probe(drive, wide, 0, 0, 3);
  }
  emit("VOLUME_BUFFERS_END\r\n"); CloseHandle(serial); ExitProcess(0);
}
