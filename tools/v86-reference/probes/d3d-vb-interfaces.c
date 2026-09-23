#define COBJMACROS
#define DIRECT3D_VERSION 0x0700
#include <windows.h>
#include <d3d.h>

unsigned long _tls_index = 0;
static HANDLE serial;
static const GUID unknown = {0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID d3d3 = {0xbb223240,0xe72b,0x11d0,{0xa9,0xb4,0,0xaa,0,0xc0,0x99,0x3e}};
static const GUID d3d7 = {0xf5049e77,0x4861,0x11d2,{0xa4,7,0,0xa0,0xc9,6,0x29,0xa8}};
static const GUID vb = {0x7a503555,0x4a83,0x11d1,{0xa5,0xdb,0,0xa0,0xc9,3,0x67,0xf8}};
static const GUID vb7 = {0xf5049e7d,0x4861,0x11d2,{0xa4,7,0,0xa0,0xc9,6,0x29,0xa8}};
static const GUID material = {0x4417c144,0x33ad,0x11cf,{0x81,0x6f,0,0,0xc0,0x20,0x15,0x6e}};
static void emit(const char *s) { DWORD n; WriteFile(serial,s,lstrlenA(s),&n,0); }
static void hex(DWORD n) {
  char b[9]; int i; const char *digits="0123456789abcdef";
  for(i=0;i<8;i++) b[i]=digits[(n>>(28-i*4))&15]; b[8]=0; emit(b);
}
static void result(const char *name,HRESULT hr) {
  emit(name); emit(" hr="); hex(hr); emit("\r\n");
}
static void query(IUnknown *obj,const GUID *iid,const char *name) {
  IUnknown *out=(IUnknown *)0xdeadbeef,*identity=0; HRESULT hr;
  hr=IUnknown_QueryInterface(obj,iid,(void **)&out);
  emit("QI name="); emit(name); emit(" hr="); hex(hr);
  emit(" null="); hex(out==0); emit(" same="); hex(out==obj);
  if(SUCCEEDED(hr) && out) {
    HRESULT ihr=IUnknown_QueryInterface(out,&unknown,(void **)&identity);
    emit(" identity_hr="); hex(ihr); emit(" identity_same="); hex(identity==obj);
    if(SUCCEEDED(ihr) && identity) IUnknown_Release(identity);
    emit(" release="); hex(IUnknown_Release(out));
  }
  emit("\r\n");
}
static void inspect(IUnknown *obj) {
  GUID forged=vb; forged.Data4[7]^=1;
  query(obj,&unknown,"IUnknown"); query(obj,&vb,"VB"); query(obj,&vb7,"VB7");
  query(obj,&material,"material"); query(obj,&forged,"forged-VB");
  forged=vb7; forged.Data4[7]^=1; query(obj,&forged,"forged-VB7");
  emit("FINAL release="); hex(IUnknown_Release(obj)); emit("\r\n");
}
void WinMainCRTStartup(void) {
  HMODULE dd; LPDIRECTDRAW draw=0; LPDIRECT3D3 root3=0; LPDIRECT3D7 root7=0;
  LPDIRECT3DVERTEXBUFFER buffer=0; LPDIRECT3DVERTEXBUFFER7 buffer7=0;
  D3DVERTEXBUFFERDESC desc; HRESULT hr;
  HDC screen; int bits;
  HRESULT (WINAPI *create)(GUID *,LPDIRECTDRAW *,IUnknown *);
  serial=CreateFileA("COM1",GENERIC_WRITE,0,0,OPEN_EXISTING,0,0);
  if(serial==INVALID_HANDLE_VALUE) ExitProcess(1);
  emit("D3D_VB_BEGIN version="); hex(GetVersion()); emit("\r\n");
  screen=GetDC(0); bits=GetDeviceCaps(screen,BITSPIXEL)*GetDeviceCaps(screen,PLANES);
  ReleaseDC(0,screen); emit("DISPLAY bpp="); hex(bits); emit("\r\n");
  if(bits<8) {
    emit("SKIP requires 256-color DirectDraw display; no QI observations\r\n");
    emit("D3D_VB_END\r\n"); CloseHandle(serial); ExitProcess(3);
  }
  dd=LoadLibraryA("DDRAW.DLL"); create=(void *)GetProcAddress(dd,"DirectDrawCreate");
  if(!create) {emit("ERROR DirectDrawCreate\r\n"); ExitProcess(2);}
  hr=create(0,&draw,0); result("DRAW",hr);
  if(SUCCEEDED(hr) && draw) {
    desc.dwSize=sizeof(desc); desc.dwCaps=D3DVBCAPS_SYSTEMMEMORY;
    desc.dwFVF=D3DFVF_XYZ; desc.dwNumVertices=4;
    hr=IDirectDraw_QueryInterface(draw,&d3d3,(void **)&root3); result("ROOT3",hr);
    if(SUCCEEDED(hr) && root3) {
      hr=IDirect3D3_CreateVertexBuffer(root3,&desc,&buffer,0,0); result("CREATE3",hr);
      if(SUCCEEDED(hr) && buffer) inspect((IUnknown *)buffer);
      IDirect3D3_Release(root3);
    }
    hr=IDirectDraw_QueryInterface(draw,&d3d7,(void **)&root7); result("ROOT7",hr);
    if(SUCCEEDED(hr) && root7) {
      hr=IDirect3D7_CreateVertexBuffer(root7,&desc,&buffer7,0); result("CREATE7",hr);
      if(SUCCEEDED(hr) && buffer7) inspect((IUnknown *)buffer7);
      IDirect3D7_Release(root7);
    }
    IDirectDraw_Release(draw);
  }
  emit("D3D_VB_END\r\n"); CloseHandle(serial); ExitProcess(0);
}
