#include <windows.h>

/* Native contract oracle. No CRT and no dependency on optional W exports. */
unsigned long _tls_index = 0;
static HANDLE serial;
static void emit(const char *s) {
  DWORD written;
  if (serial != INVALID_HANDLE_VALUE) WriteFile(serial, s, lstrlenA(s), &written, NULL);
}
static void number(DWORD n) {
  char buf[16]; int i = 15;
  buf[i] = 0;
  do { buf[--i] = '0' + n % 10; n /= 10; } while (n);
  emit(buf + i);
}
static void field(const char *name, DWORD value) { emit(name); number(value); }

static void views(HANDLE file, DWORD protection, BOOL anonymous) {
  DWORD modes[] = { FILE_MAP_READ, FILE_MAP_WRITE, FILE_MAP_COPY };
  DWORD offsets[] = { 0, 4096, 65536 };
  HANDLE section; DWORD error; int m, o;
  SetLastError(0x1234);
  section = CreateFileMappingA(file, NULL, protection, 0, 131072, NULL);
  error = GetLastError();
  emit("CREATE"); field(" anon=", anonymous); field(" protect=", protection);
  field(" ok=", section != NULL); field(" error=", error); emit("\r\n");
  if (!section) return;
  for (m = 0; m < 3; ++m) for (o = 0; o < 3; ++o) {
    void *view;
    SetLastError(0x1234);
    view = MapViewOfFile(section, modes[m], 0, offsets[o], 16);
    error = GetLastError();
    emit("VIEW"); field(" anon=", anonymous); field(" protect=", protection);
    field(" access=", modes[m]); field(" offset=", offsets[o]);
    field(" address=", (DWORD)view); field(" error=", error); emit("\r\n");
    if (view) UnmapViewOfFile(view);
  }
  CloseHandle(section);
}

static void coherence(HANDLE file, DWORD protection, DWORD access) {
  HANDLE section = CreateFileMappingA(file, NULL, protection, 0, 131072, NULL);
  volatile unsigned char *a, *b;
  if (!section) return;
  a = MapViewOfFile(section, access, 0, 0, 16);
  b = MapViewOfFile(section, access, 0, 0, 16);
  emit("COHERENCE"); field(" protect=", protection); field(" access=", access);
  field(" a=", (DWORD)a); field(" b=", (DWORD)b);
  if (a && b) {
    field(" before=", b[0]);
    a[0] ^= 0x5a;
    field(" written=", a[0]); field(" peer=", b[0]);
  }
  emit("\r\n");
  if (a) UnmapViewOfFile((void *)a);
  if (b) UnmapViewOfFile((void *)b);
  CloseHandle(section);
}

void WinMainCRTStartup(void) {
  typedef HANDLE (WINAPI *CreateMappingW)(HANDLE, LPSECURITY_ATTRIBUTES, DWORD, DWORD, DWORD, LPCWSTR);
  typedef HANDLE (WINAPI *OpenMappingW)(DWORD, BOOL, LPCWSTR);
  HMODULE kernel = GetModuleHandleA("kernel32.dll");
  CreateMappingW createW = (CreateMappingW)GetProcAddress(kernel, "CreateFileMappingW");
  OpenMappingW openW = (OpenMappingW)GetProcAddress(kernel, "OpenFileMappingW");
  SYSTEM_INFO info; char dir[MAX_PATH], path[MAX_PATH]; HANDLE file, section, wide;
  DWORD error, protection[] = { PAGE_READONLY, PAGE_READWRITE, PAGE_WRITECOPY }; int i;
  serial = CreateFileA("COM1", GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  emit("FILE_MAPPING_V1\r\n");
  GetSystemInfo(&info);
  field("GRANULARITY page=", info.dwPageSize); field(" allocation=", info.dwAllocationGranularity); emit("\r\n");
  if (!GetTempPathA(MAX_PATH, dir) || !GetTempFileNameA(dir, "wam", 0, path)) {
    emit("FAIL temp\r\n"); ExitProcess(1);
  }
  file = CreateFileA(path, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (file == INVALID_HANDLE_VALUE) { emit("FAIL file\r\n"); DeleteFileA(path); ExitProcess(1); }
  SetFilePointer(file, 131072, NULL, FILE_BEGIN);
  if (!SetEndOfFile(file)) { emit("FAIL size\r\n"); CloseHandle(file); DeleteFileA(path); ExitProcess(1); }
  for (i = 0; i < 3; ++i) { views(file, protection[i], FALSE); views(INVALID_HANDLE_VALUE, protection[i], TRUE); }
  coherence(file, PAGE_READWRITE, FILE_MAP_WRITE);
  coherence(file, PAGE_WRITECOPY, FILE_MAP_COPY);
  field("W_EXPORT create=", createW != NULL); field(" open=", openW != NULL); emit("\r\n");
  if (createW) {
    SetLastError(0x1234);
    wide = createW(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, 16, L"wa-mapping-wide-oracle");
    error = GetLastError(); field("W_CREATE ok=", wide != NULL); field(" error=", error); emit("\r\n");
    if (wide) CloseHandle(wide);
  }
  section = CreateFileMappingA(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, 16, "wa-mapping-wide-oracle");
  if (openW && section) {
    SetLastError(0x1234);
    wide = openW(FILE_MAP_READ, FALSE, L"wa-mapping-wide-oracle");
    error = GetLastError(); field("W_OPEN ok=", wide != NULL); field(" error=", error); emit("\r\n");
    if (wide) CloseHandle(wide);
  }
  if (section) CloseHandle(section);
  CloseHandle(file); DeleteFileA(path);
  emit("FILE_MAPPING_DONE\r\n"); CloseHandle(serial); ExitProcess(0);
}
