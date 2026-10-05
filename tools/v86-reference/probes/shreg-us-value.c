#include <windows.h>

unsigned long _tls_index = 0;
static HANDLE serial;
static BOOL ownUserKey,ownMachineKey;
static const char *keyPath = "Software\\WineAssemblySHRegUSReference";
static const char *missingPath = "Software\\WineAssemblySHRegUSReference\\Missing";
static LONG (WINAPI *createKey)(HKEY,LPCSTR,DWORD,LPSTR,DWORD,REGSAM,LPSECURITY_ATTRIBUTES,PHKEY,LPDWORD);
static LONG (WINAPI *setValue)(HKEY,LPCSTR,DWORD,DWORD,const BYTE *,DWORD);
static LONG (WINAPI *closeKey)(HKEY);
static LONG (WINAPI *deleteKey)(HKEY,LPCSTR);
static LONG (WINAPI *getUS)(LPCSTR,LPCSTR,LPDWORD,void *,LPDWORD,BOOL,void *,DWORD);

static void emit(const char *s) { DWORD n; WriteFile(serial,s,lstrlenA(s),&n,0); }
static void hex(DWORD n) {
  char b[9]; int i; const char *digits="0123456789abcdef";
  for(i=0;i<8;i++) b[i]=digits[(n>>(28-i*4))&15]; b[8]=0; emit(b);
}
static BOOL seed(HKEY root, BOOL user) {
  HKEY key=0; DWORD disposition=0; LONG result; BYTE data[8]; int i;
  result=createKey(root,keyPath,0,0,0,KEY_ALL_ACCESS,0,&key,&disposition);
  if(result) return FALSE;
  /* Never overwrite or delete an existing key, even in the reference VM. */
  if(disposition!=REG_CREATED_NEW_KEY) {closeKey(key);return FALSE;}
  if(user) ownUserKey=TRUE; else ownMachineKey=TRUE;
  for(i=0;i<8;i++) data[i]=(BYTE)((user?0x10:0x20)+i);
  result=setValue(key,"Both",0,REG_BINARY,data,4);
  result|=setValue(key,"Sized",0,REG_BINARY,data,user?8:4);
  result|=setValue(key,"BothTooLarge",0,REG_BINARY,data,user?8:6);
  if(user) result|=setValue(key,"UserOnlyLarge",0,REG_BINARY,data,8);
  if(!user) result|=setValue(key,"MachineOnly",0,REG_BINARY,data,4);
  result|=setValue(key,0,0,REG_BINARY,data,4);
  result|=closeKey(key);
  return result==0;
}
static void row(const char *label,const char *path,const char *value,
                BOOL ignore,DWORD capacity,DWORD defaultSize,BOOL queryOnly) {
  BYTE out[16],fallback[8]; DWORD size=capacity,type=0x12345678,last; LONG result; int i;
  for(i=0;i<16;i++) out[i]=0xa5;
  for(i=0;i<8;i++) fallback[i]=(BYTE)(0xd0+i);
  SetLastError(0x5a5aa55a);
  result=getUS(path,value,&type,queryOnly?0:out,&size,ignore,
    defaultSize?fallback:0,defaultSize);
  last=GetLastError();
  emit("ROW "); emit(label); emit(" ret="); hex(result);
  emit(" type="); hex(type); emit(" size="); hex(size);
  emit(" last="); hex(last); emit(" data=");
  for(i=0;i<16;i++) {char b[3];const char *d="0123456789abcdef";b[0]=d[out[i]>>4];b[1]=d[out[i]&15];b[2]=0;emit(b);}
  emit("\r\n");
}
void WinMainCRTStartup(void) {
  HMODULE adv,shell; LONG cleanupUser,cleanupMachine;
  serial=CreateFileA("COM1",GENERIC_WRITE,0,0,OPEN_EXISTING,0,0);
  if(serial==INVALID_HANDLE_VALUE) ExitProcess(1);
  emit("SHREG_US_BEGIN version="); hex(GetVersion()); emit("\r\n");
  adv=LoadLibraryA("ADVAPI32.DLL"); shell=LoadLibraryA("SHLWAPI.DLL");
  createKey=(void *)GetProcAddress(adv,"RegCreateKeyExA");
  setValue=(void *)GetProcAddress(adv,"RegSetValueExA");
  closeKey=(void *)GetProcAddress(adv,"RegCloseKey");
  deleteKey=(void *)GetProcAddress(adv,"RegDeleteKeyA");
  getUS=(void *)GetProcAddress(shell,"SHRegGetUSValueA");
  if(!createKey||!setValue||!closeKey||!deleteKey||!getUS) {emit("ERROR exports\r\n");ExitProcess(2);}
  if(!seed(HKEY_CURRENT_USER,TRUE)||!seed(HKEY_LOCAL_MACHINE,FALSE)) {
    emit("ERROR seed\r\n");
    if(ownUserKey) deleteKey(HKEY_CURRENT_USER,keyPath);
    if(ownMachineKey) deleteKey(HKEY_LOCAL_MACHINE,keyPath);
    ExitProcess(3);
  }
  row("user-first",keyPath,"Both",FALSE,16,0,FALSE);
  row("ignore-user",keyPath,"Both",TRUE,16,0,FALSE);
  row("ignore-user-nonzero",keyPath,"Both",2,16,0,FALSE);
  row("missing-user-value",keyPath,"MachineOnly",FALSE,16,0,FALSE);
  row("default-value-name",keyPath,0,FALSE,16,0,FALSE);
  row("query-size",keyPath,"Both",FALSE,0,0,TRUE);
  row("short-no-default",keyPath,"Both",FALSE,2,0,FALSE);
  row("short-with-default",keyPath,"Both",FALSE,2,4,FALSE);
  row("user-too-large-machine-fits",keyPath,"Sized",FALSE,4,0,FALSE);
  row("user-too-large-default",keyPath,"Sized",FALSE,4,4,FALSE);
  row("both-too-large",keyPath,"BothTooLarge",FALSE,4,0,FALSE);
  row("both-too-large-default",keyPath,"BothTooLarge",FALSE,4,4,FALSE);
  row("user-only-too-large",keyPath,"UserOnlyLarge",FALSE,4,0,FALSE);
  row("user-only-too-large-default",keyPath,"UserOnlyLarge",FALSE,4,4,FALSE);
  row("short-small-default",keyPath,"Both",FALSE,2,1,FALSE);
  row("missing-value",keyPath,"Absent",FALSE,16,0,FALSE);
  row("missing-value-default",keyPath,"Absent",FALSE,16,4,FALSE);
  row("missing-key",missingPath,"Absent",FALSE,16,0,FALSE);
  row("default-cap0",missingPath,"Absent",FALSE,0,4,FALSE);
  row("default-cap2",missingPath,"Absent",FALSE,2,4,FALSE);
  row("default-cap4",missingPath,"Absent",FALSE,4,4,FALSE);
  row("default-cap16",missingPath,"Absent",FALSE,16,4,FALSE);
  cleanupUser=deleteKey(HKEY_CURRENT_USER,keyPath);
  cleanupMachine=deleteKey(HKEY_LOCAL_MACHINE,keyPath);
  emit("CLEANUP user=");hex(cleanupUser);emit(" machine=");hex(cleanupMachine);emit("\r\n");
  emit("SHREG_US_END\r\n");CloseHandle(serial);ExitProcess(0);
}
