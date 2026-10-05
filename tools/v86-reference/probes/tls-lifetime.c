#include <windows.h>

/* Native Win98 oracle. No CRT or compiler TLS; worker observations are handed
   back over events so COM1 output has one writer and a deterministic order. */
unsigned long _tls_index = 0;
static HANDLE serial, go, done;
static DWORD chosen;
static volatile DWORD command, result, error;

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
static void row(const char *label, DWORD value, DWORD lastError) {
  emit("TLS label="); emit(label); emit(" result="); number(value);
  emit(" error="); number(lastError); emit("\r\n");
}
static void readValue(const char *label, DWORD index) {
  DWORD value, lastError;
  SetLastError(0x1234);
  value = (DWORD)TlsGetValue(index); lastError = GetLastError();
  row(label, value, lastError);
}
static void freeIndex(const char *label, DWORD index) {
  DWORD value, lastError;
  SetLastError(0x1234);
  value = TlsFree(index); lastError = GetLastError();
  row(label, value, lastError);
}
static void setValue(const char *label, DWORD index, DWORD input) {
  DWORD value, lastError;
  SetLastError(0x1234);
  value = TlsSetValue(index, (LPVOID)input); lastError = GetLastError();
  row(label, value, lastError);
}
static DWORD WINAPI worker(LPVOID unused) {
  (void)unused;
  TlsSetValue(chosen, (LPVOID)0x55667788);
  SetEvent(done);
  for (;;) {
    if (WaitForSingleObject(go, 5000) != WAIT_OBJECT_0) return 1;
    if (!command) return 0;
    SetLastError(0x1234);
    if (command == 2) result = TlsAlloc();
    else result = (DWORD)TlsGetValue(chosen);
    error = GetLastError();
    SetEvent(done);
  }
}
static void workerStep(const char *label, DWORD cmd) {
  command = cmd;
  SetEvent(go);
  if (WaitForSingleObject(done, 5000) != WAIT_OBJECT_0) {
    emit("FAIL worker timeout\r\n"); ExitProcess(2);
  }
  row(label, result, error);
}
void WinMainCRTStartup(void) {
  DWORD ids[128], count = 0, index, lastError, i, tid;
  HANDLE thread;
  serial = CreateFileA("COM1", GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (serial == INVALID_HANDLE_VALUE) ExitProcess(1);
  emit("TLS_LIFETIME_BEGIN\r\n");
  row("version", GetVersion(), 0);
  while (count < 128) {
    SetLastError(0x1234);
    index = TlsAlloc(); lastError = GetLastError();
    if (index == TLS_OUT_OF_INDEXES) break;
    ids[count++] = index;
    row("allocate", index, lastError);
  }
  row("exhausted", index, lastError);
  row("capacity", count, 0);
  if (count < 2 || count == 128) { emit("FAIL capacity\r\n"); ExitProcess(2); }
  chosen = ids[count / 2]; row("chosen", chosen, 0);
  readValue("initial-main", chosen);
  setValue("set-main-status", chosen, 0x11223344);
  go = CreateEventA(NULL, FALSE, FALSE, NULL);
  done = CreateEventA(NULL, FALSE, FALSE, NULL);
  thread = CreateThread(NULL, 0, worker, NULL, 0, &tid);
  if (!go || !done || !thread || WaitForSingleObject(done, 5000) != WAIT_OBJECT_0) {
    emit("FAIL worker creation\r\n"); ExitProcess(2);
  }
  readValue("set-main", chosen);
  workerStep("set-worker", 1);
  freeIndex("free", chosen);
  readValue("freed-main", chosen);
  workerStep("freed-worker", 1);
  freeIndex("free-again", chosen);
  SetLastError(0x1234); index = TlsAlloc(); lastError = GetLastError();
  row("reuse-main", index, lastError);
  readValue("reused-main", chosen);
  workerStep("reused-worker", 1);
  TlsSetValue(chosen, (LPVOID)0x99aabbcc);
  freeIndex("free-for-worker", chosen);
  workerStep("reuse-by-worker", 2);
  readValue("worker-reused-main", chosen);
  workerStep("worker-reused-worker", 1);
  setValue("set-index-64", 64, 0xabcdef01);
  readValue("get-index-64", 64);
  setValue("set-index-79", 79, 0x12345678);
  readValue("get-index-79", 79);
  setValue("set-index-80", 80, 0x12345678);
  readValue("get-index-80", 80);
  readValue("get-index-81", 81);
  readValue("invalid-get-max", 0xffffffff);
  freeIndex("free-index-64", 64);
  readValue("freed-index-64", 64);
  freeIndex("free-index-80", 80);
  freeIndex("invalid-free-max", 0xffffffff);
  command = 0; SetEvent(go);
  if (WaitForSingleObject(thread, 5000) != WAIT_OBJECT_0) {
    emit("FAIL worker exit\r\n"); ExitProcess(2);
  }
  CloseHandle(thread); CloseHandle(go); CloseHandle(done);
  for (i = 0; i < count; ++i) TlsFree(ids[i]);
  emit("TLS_LIFETIME_DONE\r\n");
  CloseHandle(serial);
  ExitProcess(0);
}
