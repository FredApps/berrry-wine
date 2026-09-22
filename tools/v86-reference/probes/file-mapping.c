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

static void query(const char *label, void *address);
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
  if (a) query("COHERENCE_UNMAPPED", (void *)a);
  b = MapViewOfFile(section, access, 0, 0, 16);
  field("COHERENCE_REOPEN protect=", protection); field(" address=", (DWORD)b);
  if (b) { field(" value=", b[0]); UnmapViewOfFile((void *)b); }
  emit("\r\n");
  CloseHandle(section);
}

static void query(const char *label, void *address) {
  MEMORY_BASIC_INFORMATION info;
  DWORD count = VirtualQuery(address, &info, sizeof(info));
  emit(label); field(" address=", (DWORD)address); field(" count=", count);
  if (count) {
    field(" base=", (DWORD)info.BaseAddress); field(" allocation=", (DWORD)info.AllocationBase);
    field(" size=", info.RegionSize); field(" state=", info.State); field(" protect=", info.Protect);
    field(" allocationProtect=", info.AllocationProtect); field(" type=", info.Type);
  }
  emit("\r\n");
}

static void distinctSections(const char *path, DWORD first, DWORD second, BOOL dirtyPeer) {
  HANDLE file = CreateFileA(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
    NULL, OPEN_EXISTING, 0, NULL);
  HANDLE a, b; volatile unsigned char *av, *bv; DWORD ae, be;
  unsigned char seed[2] = { 65, 66 }; DWORD count;
  DWORD am = first == PAGE_READONLY ? FILE_MAP_READ : first == PAGE_WRITECOPY ? FILE_MAP_COPY : FILE_MAP_WRITE;
  DWORD bm = second == PAGE_READONLY ? FILE_MAP_READ : second == PAGE_WRITECOPY ? FILE_MAP_COPY : FILE_MAP_WRITE;
  WriteFile(file, seed, 2, &count, NULL); FlushFileBuffers(file);
  SetLastError(0x1234); a = CreateFileMappingA(file, NULL, first, 0, 131072, NULL); ae = GetLastError();
  SetLastError(0x1234); b = CreateFileMappingA(file, NULL, second, 0, 131072, NULL); be = GetLastError();
  av = a ? MapViewOfFile(a, am, 0, 0, 16) : NULL;
  bv = b ? MapViewOfFile(b, bm, 0, 0, 16) : NULL;
  field("DISTINCT first=", first); field(" second=", second);
  field(" dirtyPeer=", dirtyPeer);
  field(" file=", (DWORD)file);
  field(" aHandle=", (DWORD)a); field(" bHandle=", (DWORD)b);
  field(" aError=", ae); field(" bError=", be);
  field(" a=", (DWORD)av); field(" b=", (DWORD)bv);
  if (av && bv && first != PAGE_READONLY) {
    field(" before=", bv[0]); av[0] ^= 0x5a;
    field(" written=", av[0]); field(" peer=", bv[0]);
  }
  if (bv && dirtyPeer) { bv[1] ^= 0x5a; field(" peerSecond=", bv[1]); }
  emit("\r\n");
  if (a) CloseHandle(a);
  if (av) UnmapViewOfFile((void *)av);
  if (bv) { field("DISTINCT_SURVIVOR value=", bv[0]); emit("\r\n"); UnmapViewOfFile((void *)bv); }
  if (b) CloseHandle(b);
  SetLastError(0x1234);
  ae = GetFileSize(file, NULL); be = GetLastError();
  field("DISTINCT_FILE size=", ae); field(" error=", be); emit("\r\n");
  CloseHandle(file);
  file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
  count = 0;
  if (file != INVALID_HANDLE_VALUE) { ReadFile(file, seed, 2, &count, NULL); CloseHandle(file); }
  field("DISTINCT_DISK count=", count); field(" first=", seed[0]); field(" second=", seed[1]); emit("\r\n");
}

static void protectionChanges(HANDLE file, DWORD protection) {
  HANDLE section = CreateFileMappingA(file, NULL, protection, 0, 131072, NULL);
  void *read, *write, *again;
  if (!section) return;
  field("PROTECTION_CASE section=", protection); emit("\r\n");
  read = MapViewOfFile(section, FILE_MAP_READ, 0, 0, 16);
  if (!read) { CloseHandle(section); return; }
  query("PROTECT_INITIAL", read);
  query("PROTECT_UNTOUCHED", (char *)read + 4096);
  write = MapViewOfFile(section, protection == PAGE_WRITECOPY ? FILE_MAP_COPY : FILE_MAP_WRITE, 0, 0, 8192);
  query("PROTECT_WRITABLE", read);
  again = MapViewOfFile(section, FILE_MAP_READ, 0, 0, 16);
  query("PROTECT_READ_AGAIN", read);
  query("PROTECT_READ_TAIL", (char *)read + 4096);
  if (again) UnmapViewOfFile(again);
  query("PROTECT_UNMAP_READ", read);
  if (write) UnmapViewOfFile(write);
  query("PROTECT_UNMAP_WRITE", read);
  UnmapViewOfFile(read);
  CloseHandle(section);
}

static void ranges(HANDLE file) {
  HANDLE section = CreateFileMappingA(file, NULL, PAGE_READWRITE, 0, 131072, NULL);
  void *small, *large, *tail; BOOL ok; DWORD error;
  if (!section) return;
  small = MapViewOfFile(section, FILE_MAP_READ, 0, 0, 16);
  query("RANGE_SMALL", small);
  large = MapViewOfFile(section, FILE_MAP_WRITE, 0, 0, 131072);
  tail = MapViewOfFile(section, FILE_MAP_WRITE, 0, 65536, 16);
  query("RANGE_LARGE", large); query("RANGE_TAIL", tail);
  if (large && tail) {
    volatile unsigned char *a = large, *b = tail;
    a[65536] ^= 0x5a;
    field("RANGE_ALIAS written=", a[65536]); field(" peer=", b[0]); emit("\r\n");
  }
  CloseHandle(section);
  SetLastError(0x1234); ok = small ? UnmapViewOfFile(small) : FALSE; error = GetLastError();
  field("UNMAP_SMALL ok=", ok); field(" error=", error); emit("\r\n");
  query("AFTER_SMALL", large);
  SetLastError(0x1234); ok = large ? UnmapViewOfFile(large) : FALSE; error = GetLastError();
  field("UNMAP_LARGE ok=", ok); field(" error=", error); emit("\r\n");
  query("AFTER_LARGE", tail);
  SetLastError(0x1234); ok = tail ? UnmapViewOfFile(tail) : FALSE; error = GetLastError();
  field("UNMAP_TAIL ok=", ok); field(" error=", error); emit("\r\n");
  query("AFTER_TAIL", tail);
  SetLastError(0x1234); ok = tail ? UnmapViewOfFile(tail) : FALSE; error = GetLastError();
  field("UNMAP_STALE ok=", ok); field(" error=", error); emit("\r\n");
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
  ranges(file);
  protectionChanges(file, PAGE_READWRITE);
  protectionChanges(file, PAGE_WRITECOPY);
  CloseHandle(file); file = INVALID_HANDLE_VALUE;
  for (i = 0; i < 3; ++i) {
    int j;
    for (j = 0; j < 3; ++j) distinctSections(path, protection[i], protection[j], FALSE);
  }
  distinctSections(path, PAGE_READWRITE, PAGE_READWRITE, TRUE);
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
  if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
  DeleteFileA(path);
  emit("FILE_MAPPING_DONE\r\n"); CloseHandle(serial); ExitProcess(0);
}
