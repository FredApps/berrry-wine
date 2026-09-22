#include <windows.h>

/* Native oracle: no CRT; observe the format instead of borrowing emulators. */
unsigned long _tls_index = 0;
static HANDLE serial;
static char file[MAX_PATH];
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
static void field(const char *name, DWORD value) { emit(name); number(value); }
static void bytes(const unsigned char *data, UINT n) {
  static const char hex[] = "0123456789ABCDEF";
  UINT i;
  for (i = 0; i < n; ++i) {
    char s[3]; s[0] = hex[data[i] >> 4]; s[1] = hex[data[i] & 15]; s[2] = 0; emit(s);
  }
}
static void readCase(const char *label, const char *value, UINT size) {
  unsigned char out[10]; UINT i; BOOL ok; DWORD error;
  WritePrivateProfileStringA("section", "key", value, file);
  for (i = 0; i < sizeof(out); ++i) out[i] = 0xCC;
  SetLastError(0x1234);
  ok = GetPrivateProfileStructA("section", "key", out + 1, size, file);
  error = GetLastError();
  emit("READ label="); emit(label); field(" size=", size);
  field(" ok=", ok); field(" error=", error); emit(" bytes="); bytes(out, sizeof(out)); emit("\r\n");
}
void WinMainCRTStartup(void) {
  char dir[MAX_PATH], stored[128];
  unsigned char data[4] = { 0x01, 0x80, 0xFE, 0xFF };
  UINT size; BOOL ok; DWORD error;
  serial = CreateFileA("COM1", GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (serial == INVALID_HANDLE_VALUE) ExitProcess(1);
  emit("PROFILE_STRUCT_BEGIN\r\n");
  if (!GetTempPathA(sizeof(dir), dir) || !GetTempFileNameA(dir, "wpr", 0, file)) {
    emit("FAIL temp\r\n"); ExitProcess(1);
  }
  for (size = 0; size <= 4; ++size) {
    SetLastError(0x1234);
    ok = WritePrivateProfileStructA("section", "key", data, size, file);
    error = GetLastError();
    GetPrivateProfileStringA("section", "key", "MISSING", stored, sizeof(stored), file);
    field("WRITE size=", size); field(" ok=", ok); field(" error=", error);
    emit(" value="); emit(stored); emit("\r\n");
  }
  readCase("valid", "0180FEFF7E", 4);
  readCase("lowercase", "0180feff7e", 4);
  readCase("checksum", "0180FEFF7F", 4);
  readCase("bad-first", "G180FEFF7E", 4);
  readCase("bad-middle", "0180GEFF7E", 4);
  readCase("bad-checksum", "0180FEFFGE", 4);
  readCase("short", "0180FEFF", 4);
  readCase("long", "0180FEFF7E00", 4);
  readCase("quoted", "\"0180FEFF7E\"", 4);
  readCase("zero", "00", 0);
  readCase("zero-bad", "01", 0);
  readCase("empty", "", 4);
  readCase("missing", NULL, 4);
  readCase("size-small", "0180FEFF7E", 3);
  readCase("size-large", "0180FEFF7E", 5);
  /* Determine native nibble conversion, including punctuation and G..Z.
     Wrong checksums still expose decoded bytes, which is the point here. */
  for (size = 33; size < 127; ++size) {
    char value[5] = "0000";
    field("CHAR code=", size); emit("\r\n");
    value[0] = (char)size; readCase("high", value, 1);
    value[0] = '0'; value[1] = (char)size; readCase("low", value, 1);
  }
  DeleteFileA(file);
  emit("PROFILE_STRUCT_DONE\r\n");
  CloseHandle(serial);
  ExitProcess(0);
}
