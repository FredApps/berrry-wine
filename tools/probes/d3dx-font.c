#define COBJMACROS
#include <windows.h>
#include <d3d9.h>

/* Exercise the supplied Microsoft D3DX DLL, not a substitute font renderer.
 * Run with the CLI's software D3D9 option and an explicit d3dx9_25.dll seed.
 * The final frame should contain white text on a blue background. */
unsigned long _tls_index=0;
/* Keep fixture initialization on the Win98 scalar CPU baseline rather than
 * pulling the toolchain runtime's SSE2 memset implementation. */
void *memset(void *p,int value,size_t count) {
  volatile unsigned char *out=(volatile unsigned char*)p;
  size_t i;for(i=0;i<count;i++)out[i]=(unsigned char)value;return p;
}
typedef IDirect3D9 *(WINAPI *Create9)(UINT);
typedef HRESULT (WINAPI *D3DXCreateFontProc)(IDirect3DDevice9*,INT,UINT,UINT,UINT,
  BOOL,DWORD,DWORD,DWORD,DWORD,LPCSTR,void**);
typedef INT (WINAPI *FontDraw)(void*,void*,LPCSTR,INT,RECT*,DWORD,D3DCOLOR);
static void report(const char *name,LONG value) {
  char line[128]; DWORD written;
  int count=wsprintfA(line,"D3DX_FONT %s=%ld\r\n",name,value);
  WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),line,count,&written,NULL);
}
void WinMainCRTStartup(void) {
  WNDCLASSA wc; HWND window; HMODULE d3dModule,helper;
  IDirect3D9 *d3d; IDirect3DDevice9 *device=NULL;
  D3DPRESENT_PARAMETERS pp; void *font=NULL; HRESULT hr; INT height;
  RECT rect={12,12,308,148}; Create9 create9; D3DXCreateFontProc createFont;
  ZeroMemory(&wc,sizeof(wc)); wc.lpfnWndProc=DefWindowProcA;
  wc.hInstance=GetModuleHandleA(NULL); wc.lpszClassName="D3DXFontProbe";
  RegisterClassA(&wc);
  window=CreateWindowExA(0,wc.lpszClassName,"D3DX font probe",
    WS_OVERLAPPEDWINDOW|WS_VISIBLE,0,0,340,200,NULL,NULL,wc.hInstance,NULL);
  d3dModule=LoadLibraryA("d3d9.dll");
  create9=(Create9)GetProcAddress(d3dModule,"Direct3DCreate9");
  if(!window||!create9){report("setup",-1);ExitProcess(1);}
  d3d=create9(D3D_SDK_VERSION);
  if(!d3d){report("create9",-1);ExitProcess(2);}
  ZeroMemory(&pp,sizeof(pp)); pp.BackBufferWidth=320;pp.BackBufferHeight=160;
  pp.BackBufferFormat=D3DFMT_A8R8G8B8;pp.BackBufferCount=1;
  pp.SwapEffect=D3DSWAPEFFECT_DISCARD;pp.hDeviceWindow=window;pp.Windowed=TRUE;
  pp.PresentationInterval=D3DPRESENT_INTERVAL_IMMEDIATE;
  hr=IDirect3D9_CreateDevice(d3d,0,D3DDEVTYPE_HAL,window,
    D3DCREATE_SOFTWARE_VERTEXPROCESSING,&pp,&device);
  report("device",hr);if(FAILED(hr))ExitProcess(3);
  helper=LoadLibraryA("d3dx9_25.dll");
  createFont=(D3DXCreateFontProc)GetProcAddress(helper,"D3DXCreateFontA");
  if(!createFont){report("helper",-1);ExitProcess(4);}
  hr=createFont(device,-24,0,400,1,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,
    DEFAULT_QUALITY,DEFAULT_PITCH,"Arial",&font);
  report("font",hr);if(FAILED(hr))ExitProcess(5);
  hr=IDirect3DDevice9_Clear(device,0,NULL,D3DCLEAR_TARGET,0xff204080,1,0);
  report("clear",hr);if(FAILED(hr))ExitProcess(6);
  hr=IDirect3DDevice9_BeginScene(device);report("begin",hr);
  if(FAILED(hr))ExitProcess(7);
  height=((FontDraw)(*(void***)font)[14])(font,NULL,"Black & White 2",-1,
    &rect,DT_LEFT|DT_TOP|DT_SINGLELINE,0xffffffff);
  report("drawHeight",height);
  hr=IDirect3DDevice9_EndScene(device);report("end",hr);
  hr=IDirect3DDevice9_Present(device,NULL,NULL,NULL,NULL);report("present",hr);
  /* Keep objects alive for the caller's final canonical framebuffer capture. */
  Sleep(50);ExitProcess(height>0&&SUCCEEDED(hr)?0:8);
}
