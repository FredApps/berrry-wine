/* Native USER reference, deliberately independent of emulator assertions. */
#include <windows.h>
unsigned long _tls_index = 0;
static HANDLE serial;
static int clicks;
static int tracing, trace_kind;
static WNDPROC original_button;
static HWND nested_focus_target;
static int nested_focus_armed;
static void row(const char *label, int a, int b, int c, int d) {
  char buf[160]; DWORD written;
  wsprintfA(buf, "%s %d %d %d %d\r\n", label, a, b, c, d);
  WriteFile(serial, buf, lstrlenA(buf), &written, NULL);
}
static LRESULT CALLBACK proc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_COMMAND && HIWORD(w) == BN_CLICKED) {
    clicks++;
    if (tracing) row("CLICK kind/state/capture/count", trace_kind,
      SendMessageA((HWND)l, BM_GETSTATE, 0, 0), GetCapture() == (HWND)l, clicks);
    if (nested_focus_armed) {
      nested_focus_armed = 0;
      SetFocus(nested_focus_target);
      row("NESTED_FOCUS kind/target-focused/button-state/target-state", trace_kind,
        GetFocus() == nested_focus_target, SendMessageA((HWND)l, BM_GETSTATE, 0, 0),
        SendMessageA(nested_focus_target, BM_GETSTATE, 0, 0));
    }
  }
  return DefWindowProcA(h, m, w, l);
}
static LRESULT CALLBACK button_proc(HWND h, UINT m, WPARAM w, LPARAM l) {
  LRESULT result;
  int log = tracing && (m == WM_KEYDOWN || m == WM_KEYUP || m == WM_KILLFOCUS ||
    m == WM_CAPTURECHANGED || m == BM_SETSTATE || m == WM_LBUTTONUP);
  if (log) row("ENTER kind/msg/state/clicks", trace_kind, m, SendMessageA(h, BM_GETSTATE, 0, 0), clicks);
  result = CallWindowProcA(original_button, h, m, w, l);
  if (log) row("LEAVE kind/msg/state/clicks", trace_kind, m, SendMessageA(h, BM_GETSTATE, 0, 0), clicks);
  return result;
}
void WINAPI WinMainCRTStartup(void) {
  WNDCLASSA wc = {0}; HWND parent, button, alternate; int kind, before, after, mode;
  serial = CreateFileA("COM1", GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  wc.lpfnWndProc = proc; wc.hInstance = GetModuleHandleA(NULL);
  wc.lpszClassName = "ButtonReference";
  RegisterClassA(&wc);
  parent = CreateWindowA(wc.lpszClassName, "Button reference", WS_OVERLAPPEDWINDOW | WS_VISIBLE,
    20, 20, 300, 160, NULL, NULL, wc.hInstance, NULL);
  row("VERSION", GetVersion(), 0, 0, 0);
  for (kind = 0; kind <= 11; kind++) {
    button = CreateWindowA("BUTTON", "Test", WS_CHILD | WS_VISIBLE | WS_TABSTOP | kind,
      10, 10, 100, 24, parent, (HMENU)100, wc.hInstance, NULL);
    before = SendMessageA(button, WM_GETDLGCODE, 0, 0);
    SetFocus(button);
    after = SendMessageA(button, WM_GETDLGCODE, 0, 0);
    row("DLGC kind/before/focused/style", kind, before, after, GetWindowLongA(button, GWL_STYLE) & 15);
    clicks = 0;
    SendMessageA(button, WM_KEYDOWN, VK_SPACE, 1);
    SendMessageA(button, WM_KEYDOWN, VK_SPACE, 0x40000001);
    row("SPACE_DOWN kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    SendMessageA(button, WM_KEYUP, VK_SPACE, 0xc0390001);
    row("SPACE_UP kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    clicks = 0;
    SendMessageA(button, BM_SETSTATE, TRUE, 0);
    row("HIGHLIGHT kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    SendMessageA(button, BM_SETSTATE, FALSE, 0);
    SendMessageA(button, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(5, 5));
    row("MOUSE_DOWN kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    SendMessageA(button, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(-1, 5));
    row("MOUSE_OUT kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    SendMessageA(button, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(5, 5));
    row("MOUSE_BACK kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    ReleaseCapture();
    row("CAPTURE_LOST kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    trace_kind = kind;
    original_button = (WNDPROC)SetWindowLongA(button, GWL_WNDPROC, (LONG)button_proc);
    tracing = 1;
    SendMessageA(button, WM_KEYDOWN, VK_SPACE, 1);
    row("SECOND_SPACE_DOWN kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    SetFocus(parent);
    row("FOCUS_LOST kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
    tracing = 0;
    /* Isolate origin and visual state, retaining the same native procedure. */
    for (mode = 0; mode < 4; mode++) {
      SetFocus(button);
      SendMessageA(button, BM_SETCHECK, 0, 0);
      clicks = 0;
      row("FOCUS_CASE kind/mode", kind, mode, 0, 0);
      if (mode < 2) {
        SendMessageA(button, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(5, 5));
        if (mode == 1) SendMessageA(button, WM_MOUSEMOVE, MK_LBUTTON, MAKELPARAM(-1, 5));
      } else {
        if (mode == 2) SendMessageA(button, WM_KEYDOWN, VK_SPACE, 1);
        SendMessageA(button, BM_SETSTATE, mode == 3, 0);
      }
      row("FOCUS_CASE_BEFORE kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
      tracing = 1;
      SetFocus(parent);
      row("FOCUS_CASE_AFTER kind/state/capture/clicks", kind, SendMessageA(button, BM_GETSTATE, 0, 0), GetCapture() == button, clicks);
      tracing = 0;
      ReleaseCapture();
    }
    alternate = CreateWindowA("BUTTON", "Other", WS_CHILD | WS_VISIBLE | WS_TABSTOP,
      120, 10, 100, 24, parent, (HMENU)101, wc.hInstance, NULL);
    for (mode = 0; mode < 2; mode++) {
      SetFocus(button);
      SendMessageA(button, BM_SETCHECK, 0, 0);
      SendMessageA(button, BM_SETSTATE, TRUE, 0);
      clicks = 0;
      nested_focus_target = mode ? alternate : button;
      nested_focus_armed = 1;
      tracing = 1;
      row("REFOCUS_CASE kind/mode", kind, mode, 0, 0);
      SetFocus(parent);
      row("REFOCUS_RESULT kind/focus-button/focus-alternate/button-state", kind,
        GetFocus() == button, GetFocus() == alternate, SendMessageA(button, BM_GETSTATE, 0, 0));
      row("REFOCUS_OTHER kind/alternate-state/clicks/armed", kind,
        SendMessageA(alternate, BM_GETSTATE, 0, 0), clicks, nested_focus_armed);
      tracing = 0;
      nested_focus_armed = 0;
    }
    DestroyWindow(alternate);
    SetWindowLongA(button, GWL_WNDPROC, (LONG)original_button);
    DestroyWindow(button);
  }
  row("BUTTON_INPUT_DONE", 0, 0, 0, 0);
  CloseHandle(serial);
  ExitProcess(0);
}
