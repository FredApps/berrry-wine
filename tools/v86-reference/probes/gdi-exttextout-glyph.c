#include <windows.h>

/* Native Win98 oracle for the ExtTextOut/MoveToEx sequence in D3DX9 fonts. */
unsigned long _tls_index = 0;
static HANDLE serial;
static void emit(const char *s) { DWORD n; WriteFile(serial,s,lstrlenA(s),&n,NULL); }
static void number(LONG v) {
  char b[16]; int n=0; ULONG u;
  if(v<0) { emit("-"); u=(ULONG)(-(v+1))+1; } else u=(ULONG)v;
  do { b[n++]=(char)('0'+u%10); u/=10; } while(u);
  while(n) { DWORD written; WriteFile(serial,&b[--n],1,&written,NULL); }
}
void WinMainCRTStartup(void) {
  HDC dc; HBITMAP bitmap; HFONT font; BITMAPINFO bmi;
  DWORD *pixels; GCP_RESULTSA gcp; WCHAR glyph=0,wide='A';
  RECT rect={0,0,48,32}; POINT point; int i,j; UINT options;
  serial=CreateFileA("COM1",GENERIC_WRITE,0,NULL,OPEN_EXISTING,0,NULL);
  dc=CreateCompatibleDC(NULL);
  ZeroMemory(&bmi,sizeof(bmi)); bmi.bmiHeader.biSize=40;
  bmi.bmiHeader.biWidth=64; bmi.bmiHeader.biHeight=-32;
  bmi.bmiHeader.biPlanes=1; bmi.bmiHeader.biBitCount=32;
  bitmap=CreateDIBSection(dc,&bmi,DIB_RGB_COLORS,(void**)&pixels,NULL,0);
  SelectObject(dc,bitmap);
  font=CreateFontA(-16,0,0,0,400,0,0,0,DEFAULT_CHARSET,0,0,0,0,"Arial");
  SelectObject(dc,font); SetTextColor(dc,RGB(255,255,255));
  SetBkColor(dc,RGB(0,0,0)); SetBkMode(dc,TRANSPARENT);
  SetTextAlign(dc,TA_LEFT|TA_TOP|TA_UPDATECP);
  ZeroMemory(&gcp,sizeof(gcp)); gcp.lStructSize=sizeof(gcp);
  gcp.lpGlyphs=&glyph; gcp.nGlyphs=1;
  emit("GCP result="); number(GetCharacterPlacementA(dc,"A",1,0,&gcp,0));
  emit(" glyph="); number(glyph); emit(" count="); number(gcp.nGlyphs); emit("\r\n");
  for(i=0;i<32;i++) {
    BOOL ok; int changed=0;
    int isWide=i>=16, isGlyph=(i&8)!=0, hasRect=(i&4)!=0;
    options=((i&1)?ETO_OPAQUE:0)|((i&2)?ETO_CLIPPED:0)|(isGlyph?ETO_GLYPH_INDEX:0);
    for(j=0;j<64*32;j++)pixels[j]=0;
    MoveToEx(dc,0,0,NULL); SetLastError(0x12345678);
    if(isWide)ok=ExtTextOutW(dc,9,9,options,hasRect?&rect:NULL,isGlyph?&glyph:&wide,1,NULL);
    else ok=ExtTextOutA(dc,9,9,options,hasRect?&rect:NULL,isGlyph?(LPCSTR)&glyph:"A",1,NULL);
    GetCurrentPositionEx(dc,&point); GdiFlush();
    for(j=0;j<64*32;j++)if(pixels[j]&0xffffff)changed++;
    emit("CASE i=");number(i);emit(" wide=");number(isWide);
    emit(" glyph=");number(isGlyph);emit(" rect=");number(hasRect);
    emit(" options=");number(options);emit(" ok=");number(ok);
    emit(" x=");number(point.x);emit(" y=");number(point.y);
    emit(" pixels=");number(changed);emit("\r\n");
  }
  emit("EXTTEXTOUT_GLYPH_DONE\r\n"); CloseHandle(serial); ExitProcess(0);
}
