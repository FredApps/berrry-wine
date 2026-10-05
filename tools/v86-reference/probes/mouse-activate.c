/* Native reference, not an emulator assertion. Output must end in DONE. */
#include <windows.h>
unsigned long _tls_index = 0;
static HANDLE serial;
static HWND a, b, child, c;
static int answer = -1, queries, recording;
static int hook_mode, hook_armed;
static int focus_recording;

static void emit(const char *s) {
  DWORD written;
  if (serial != INVALID_HANDLE_VALUE)
    WriteFile(serial, s, lstrlenA(s), &written, NULL);
}
static int id(HWND h) { return !h ? 0 : h == a ? 1 : h == b ? 2 : h == child ? 3 : h == c ? 4 : 0; }
static void row(const char *label, int x, int y, int z, int w) {
  char buf[160];
  wsprintfA(buf, "%s %d %d %d %d\r\n", label, x, y, z, w);
  emit(buf);
}
static LRESULT CALLBACK proc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_MOUSEACTIVATE) {
    queries++;
    if (recording) row("QUERY hwnd/top/hit/msg", id(h), id((HWND)w), LOWORD(l), HIWORD(l));
    if (answer >= 0) return answer;
  }
  if (recording && (m == WM_ACTIVATE || m == WM_SETFOCUS ||
                    m == WM_KILLFOCUS || m == WM_LBUTTONDOWN || m == WM_LBUTTONUP))
    row("DISPATCH hwnd/msg/wp/active", id(h), m, (int)w, id(GetActiveWindow()));
  if (focus_recording && (m == WM_ACTIVATE || m == WM_SETFOCUS || m == WM_KILLFOCUS))
    row("FOCUS_STATE hwnd/msg/active/focus", id(h), m, id(GetActiveWindow()), id(GetFocus()));
  if (hook_armed && m == WM_ACTIVATE &&
      ((hook_mode <= 3 && h == a && LOWORD(w) == WA_INACTIVE) ||
       ((hook_mode == 4 || hook_mode == 5) && h == b && LOWORD(w) != WA_INACTIVE))) {
    HWND old;
    hook_armed = 0;
    old = SetActiveWindow(hook_mode == 2 ? a : c);
    row("NEST return/active/focus", id(old), id(GetActiveWindow()), id(GetFocus()), 0);
    if (hook_mode == 3) {
      old = SetActiveWindow(a);
      row("BACK return/active/focus", id(old), id(GetActiveWindow()), id(GetFocus()), 0);
    }
  }
  /* Isolate USER's activation from focus assigned by default processing. */
  if (recording && (hook_mode == 5 || hook_mode == 6) && h == b && m == WM_ACTIVATE)
    return 0;
  return DefWindowProcA(h, m, w, l);
}
static void drain(void) {
  MSG msg;
  int guard = 0;
  while (guard++ < 100 && PeekMessageA(&msg, NULL, 0, 0, PM_REMOVE)) {
    TranslateMessage(&msg);
    DispatchMessageA(&msg);
  }
}
static void peek(const char *label, UINT flags) {
  MSG msg;
  BOOL got = PeekMessageA(&msg, NULL, WM_LBUTTONDOWN, WM_LBUTTONDOWN, flags);
  row(label, got, got ? msg.message : 0, queries, id(GetActiveWindow()));
  if (got && flags == PM_REMOVE) DispatchMessageA(&msg);
}
void WINAPI WinMainCRTStartup(void) {
  WNDCLASSA wc = {0};
  int hits[] = {HTCLIENT, HTCAPTION, HTSYSMENU, HTMINBUTTON, HTMAXBUTTON};
  int msgs[] = {WM_LBUTTONDOWN, WM_RBUTTONDOWN, WM_NCLBUTTONDOWN};
  int i, j, mode;
  POINT pt;
  serial = CreateFileA("COM1", GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  emit("MOUSE_ACTIVATE_V1\r\n");
  wc.lpfnWndProc = proc;
  wc.hInstance = GetModuleHandleA(NULL);
  wc.lpszClassName = "MouseActivationReference";
  wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
  if (!RegisterClassA(&wc)) { emit("FAIL register\r\n"); ExitProcess(1); }
  a = CreateWindowA(wc.lpszClassName, "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                    10, 30, 240, 200, NULL, NULL, wc.hInstance, NULL);
  b = CreateWindowA(wc.lpszClassName, "B", WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                    300, 30, 240, 200, NULL, NULL, wc.hInstance, NULL);
  child = CreateWindowA(wc.lpszClassName, "child", WS_CHILD | WS_VISIBLE,
                        10, 100, 100, 40, b, NULL, wc.hInstance, NULL);
  if (!a || !b || !child) { emit("FAIL windows\r\n"); ExitProcess(1); }
  row("VERSION", (int)GetVersion(), 0, 0, 0);
  for (i = 0; i < 5; i++) for (j = 0; j < 3; j++)
    row("DEFAULT hit/msg/result", hits[i], msgs[j],
        DefWindowProcA(b, WM_MOUSEACTIVATE, (WPARAM)b, MAKELPARAM(hits[i], msgs[j])), 0);
  recording = 1;
  for (mode = 0; mode <= 4; mode++) {
    answer = mode;
    queries = 0;
    i = DefWindowProcA(child, WM_MOUSEACTIVATE, (WPARAM)b, MAKELPARAM(HTCLIENT, WM_LBUTTONDOWN));
    row("PARENT answer/result/queries", mode, i, queries, 0);
  }
  for (mode = -1; mode <= 4; mode++) {
    recording = 0;
    answer = mode;
    SetForegroundWindow(a);
    SetActiveWindow(a);
    pt.x = 50; pt.y = 50;
    ClientToScreen(b, &pt);
    SetCursorPos(pt.x, pt.y);
    drain();
    queries = 0;
    recording = 1;
    row("CASE answer/active", mode, id(GetActiveWindow()), 0, 0);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    Sleep(50);
    row("INJECT queries/active", queries, id(GetActiveWindow()), 0, 0);
    peek("PEEK1 got/msg/queries/active", PM_NOREMOVE);
    peek("PEEK2 got/msg/queries/active", PM_NOREMOVE);
    peek("REMOVE got/msg/queries/active", PM_REMOVE);
    drain();
    recording = 0;
    SetActiveWindow(a);
    drain();
    queries = 0;
    recording = 1;
    PostMessageA(b, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(50, 50));
    peek("POST got/msg/queries/active", PM_REMOVE);
  }
  recording = 0;
  c = CreateWindowA(wc.lpszClassName, "C", WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                    100, 260, 240, 150, NULL, NULL, wc.hInstance, NULL);
  if (!c) { emit("FAIL window C\r\n"); ExitProcess(1); }
  answer = -1;
  emit("ACTIVATION_REENTRY_V1\r\n");
  for (mode = 0; mode <= 6; mode++) {
    HWND old;
    recording = 0;
    hook_armed = 0;
    SetActiveWindow(a);
    drain();
    hook_mode = mode;
    hook_armed = mode != 0;
    recording = 1;
    row("API_CASE mode/active/focus", mode, id(GetActiveWindow()), id(GetFocus()), 0);
    old = SetActiveWindow(b);
    row("OUTER return/active/focus", id(old), id(GetActiveWindow()), id(GetFocus()), 0);
    hook_armed = 0;
    drain();
  }
  emit("ACTIVATION_REENTRY_DONE\r\n");
  emit("FOCUS_DEFAULT_V1\r\n");
  hook_armed = 0;
  hook_mode = 0;
  for (mode = 0; mode < 12; mode++) {
    LRESULT result;
    recording = focus_recording = 0;
    if (mode >= 10) ShowWindow(b, SW_MINIMIZE);
    SetActiveWindow(a);
    SetFocus(a);
    drain();
    recording = focus_recording = 1;
    row("FOCUS_CASE mode/active/focus", mode, id(GetActiveWindow()), id(GetFocus()), 0);
    if (mode < 6 || mode == 10) {
      WPARAM wp = mode == 10 ? WA_ACTIVE : mode < 3 ? mode : (mode - 3) | 0x10000;
      result = DefWindowProcA(b, WM_ACTIVATE, wp, (LPARAM)a);
    } else {
      HWND target = mode == 6 ? a : (mode == 7 || mode == 11) ? b : mode == 8 ? child : NULL;
      result = id(SetFocus(target));
    }
    row("FOCUS_RETURN result/active/focus", (int)result, id(GetActiveWindow()), id(GetFocus()), 0);
    drain();
  }
  emit("FOCUS_DEFAULT_DONE\r\n");
  emit("MOUSE_ACTIVATE_DONE\r\n");
  CloseHandle(serial);
  ExitProcess(0);
}
