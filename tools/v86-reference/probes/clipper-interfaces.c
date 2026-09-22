#define COBJMACROS
#include <windows.h>
#include <oleauto.h>

unsigned long _tls_index = 0;
static HANDLE serial;
static const GUID unknown = {0,0,0,{0xc0,0,0,0,0,0,0,0x46}};
static const GUID nativeClip = {0x6c14db85,0xa733,0x11ce,{0xa5,0x21,0,0x20,0xaf,0x0b,0xe5,0x60}};
static void emit(const char *s) { DWORD n; WriteFile(serial,s,lstrlenA(s),&n,0); }
static void hex(DWORD n) {
  char b[9]; int i; const char *digits="0123456789abcdef";
  for(i=0;i<8;i++) b[i]=digits[(n>>(28-i*4))&15]; b[8]=0; emit(b);
}
static void guid(const GUID *g) {
  const DWORD *p=(const DWORD *)g; int i;
  for(i=0;i<4;i++) {if(i) emit(":"); hex(p[i]);}
}
static void wide(const WCHAR *s) {
  char c[2]={0,0}; if(!s) return;
  while(*s) {c[0]=*s<128?(char)*s:'?'; emit(c); s++;}
}
static BOOL nameIs(const WCHAR *s,const char *expected) {
  if(!s) return FALSE;
  while(*expected && *s==(BYTE)*expected) {s++; expected++;}
  return !*s && !*expected;
}
static void query(IUnknown *obj, const GUID *iid, const char *name) {
  IUnknown *out=(IUnknown *)0xdeadbeef; HRESULT hr;
  hr=IUnknown_QueryInterface(obj,iid,(void **)&out);
  emit("QI name="); emit(name); emit(" hr="); hex(hr);
  emit(" null="); hex(out==0); emit(" same="); hex(out==obj);
  if(SUCCEEDED(hr) && out) {emit(" release="); hex(IUnknown_Release(out));}
  emit("\r\n");
}
void WinMainCRTStartup(void) {
  HMODULE ole,dd; ITypeLib *lib=0; ITypeInfo *info; TYPEATTR *attr;
  BSTR name; UINT i,j,n; GUID vbClip={0}; BOOL found=FALSE; HRESULT hr;
  IUnknown *clip=0;
  HRESULT (WINAPI *load)(LPCOLESTR,ITypeLib **);
  void (WINAPI *freeBstr)(BSTR);
  HRESULT (WINAPI *create)(DWORD,void **,IUnknown *);
  serial=CreateFileA("COM1",GENERIC_WRITE,0,0,OPEN_EXISTING,0,0);
  if(serial==INVALID_HANDLE_VALUE) ExitProcess(1);
  emit("CLIPPER_INTERFACES_BEGIN version="); hex(GetVersion()); emit("\r\n");
  ole=LoadLibraryA("OLEAUT32.DLL");
  load=(void *)GetProcAddress(ole,"LoadTypeLib");
  freeBstr=(void *)GetProcAddress(ole,"SysFreeString");
  if(!load || !freeBstr) {emit("ERROR ole exports\r\n"); ExitProcess(2);}
  hr=load(L"D:\\DX7VB.DLL",&lib);
  emit("TYPELIB hr="); hex(hr); emit("\r\n");
  if(SUCCEEDED(hr)) {
    n=ITypeLib_GetTypeInfoCount(lib);
    for(i=0;i<n;i++) {
      if(FAILED(ITypeLib_GetTypeInfo(lib,i,&info))) continue;
      name=0;
      if(SUCCEEDED(ITypeInfo_GetDocumentation(info,MEMBERID_NIL,&name,0,0,0))) {
        /* Report only clipper-related names, then every method's real offset. */
        BOOL match=nameIs(name,"DirectDrawClipper");
        if(match && SUCCEEDED(ITypeInfo_GetTypeAttr(info,&attr))) {
          emit("TYPE name="); wide(name); emit(" iid="); guid(&attr->guid);
          emit(" kind="); hex(attr->typekind); emit(" flags="); hex(attr->wTypeFlags);
          emit(" vtable="); hex(attr->cbSizeVft); emit(" funcs="); hex(attr->cFuncs); emit("\r\n");
          if(attr->typekind==TKIND_INTERFACE) {vbClip=attr->guid; found=TRUE;}
          for(j=0;j<attr->cFuncs;j++) {
            FUNCDESC *fn; BSTR method=0;
            if(SUCCEEDED(ITypeInfo_GetFuncDesc(info,j,&fn))) {
              ITypeInfo_GetDocumentation(info,fn->memid,&method,0,0,0);
              emit("METHOD name="); wide(method); emit(" offset="); hex(fn->oVft);
              emit(" params="); hex(fn->cParams); emit("\r\n");
              if(nameIs(method,"IsClipListChanged") && fn->cParams==1) {
                TYPEDESC *td=&fn->lprgelemdescParam[0].tdesc;
                emit("TAIL return="); hex(fn->elemdescFunc.tdesc.vt);
                emit(" param="); hex(td->vt);
                emit(" flags="); hex(fn->lprgelemdescParam[0].paramdesc.wParamFlags);
                emit(" pointee="); hex(td->vt==VT_PTR?td->lptdesc->vt:0xffffffff);
                emit("\r\n");
              }
              freeBstr(method); ITypeInfo_ReleaseFuncDesc(info,fn);
            }
          }
          ITypeInfo_ReleaseTypeAttr(info,attr);
        }
        freeBstr(name);
      }
      ITypeInfo_Release(info);
    }
    ITypeLib_Release(lib);
  }
  dd=LoadLibraryA("DDRAW.DLL"); create=(void *)GetProcAddress(dd,"DirectDrawCreateClipper");
  if(!create) {emit("ERROR DirectDrawCreateClipper\r\n"); ExitProcess(3);}
  hr=create(0,(void **)&clip,0); emit("CREATE hr="); hex(hr); emit("\r\n");
  if(SUCCEEDED(hr)) {
    GUID forged=nativeClip; forged.Data4[7]^=1;
    query(clip,&unknown,"IUnknown"); query(clip,&nativeClip,"native");
    query(clip,&forged,"forged-tail"); if(found) query(clip,&vbClip,"VB");
    emit("FINAL release="); hex(IUnknown_Release(clip)); emit("\r\n");
  }
  if(found) {
    const GUID clsid={0xe1211353,0x8e94,0x11d1,{0x88,8,0,0xc0,0x4f,0xc2,0xc6,2}};
    const GUID factoryIid={1,0,0,{0xc0,0,0,0,0,0,0,0x46}};
    const GUID rootIid={0xfafa3599,0x8b72,0x11d2,{0x90,0xb2,0,0xc0,0x4f,0xc2,0xc6,2}};
    HMODULE vb=LoadLibraryA("D:\\DX7VB.DLL");
    HRESULT (WINAPI *getFactory)(REFCLSID,REFIID,void **);
    HRESULT (WINAPI *init)(void *);
    IClassFactory *factory=0; IUnknown *root=0,*draw=0,*vbobj=0;
    HRESULT (WINAPI *drawCreate)(void *,BSTR,void **);
    HRESULT (WINAPI *clipCreate)(void *,DWORD,void **);
    BSTR (WINAPI *allocBstr)(const OLECHAR *);
    init=(void *)GetProcAddress(LoadLibraryA("OLE32.DLL"),"CoInitialize");
    if(init) init(0);
    getFactory=(void *)GetProcAddress(vb,"DllGetClassObject");
    if(getFactory) {
      hr=getFactory(&clsid,&factoryIid,(void **)&factory);
      emit("VBFACTORY hr="); hex(hr); emit("\r\n");
      if(SUCCEEDED(hr)) {
        hr=IClassFactory_CreateInstance(factory,0,&rootIid,(void **)&root);
        emit("VBROOT hr="); hex(hr); emit("\r\n");
        IClassFactory_Release(factory);
        if(SUCCEEDED(hr)) {
          drawCreate=(void *)((void **)(root->lpVtbl))[4];
          allocBstr=(void *)GetProcAddress(ole,"SysAllocString");
          name=allocBstr(L"");
          hr=drawCreate(root,name,(void **)&draw); freeBstr(name);
          emit("VBDRAW hr="); hex(hr); emit("\r\n");
          if(SUCCEEDED(hr)) {
            clipCreate=(void *)((void **)(draw->lpVtbl))[5];
            hr=clipCreate(draw,0,(void **)&vbobj);
            emit("VBCLIP hr="); hex(hr); emit("\r\n");
            if(SUCCEEDED(hr)) {
              GUID dispatch={0x20400,0,0,{0xc0,0,0,0,0,0,0,0x46}};
              query(vbobj,&unknown,"VB-IUnknown"); query(vbobj,&vbClip,"VB-own");
              query(vbobj,&nativeClip,"VB-native"); query(vbobj,&dispatch,"VB-IDispatch");
              emit("VBFINAL release="); hex(IUnknown_Release(vbobj)); emit("\r\n");
            }
            IUnknown_Release(draw);
          }
          IUnknown_Release(root);
        }
      }
    } else {emit("ERROR VB load="); hex(GetLastError()); emit("\r\n");}
  }
  emit("CLIPPER_INTERFACES_END\r\n"); CloseHandle(serial); ExitProcess(0);
}
