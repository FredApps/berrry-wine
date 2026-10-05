# Classic Media Player (`mplay32.exe`)

Fixture: `test/binaries/win98-apps/mplay32.exe`, SHA-256
`c229b5af9f5bb641654dc0ebe6bbd0a66f215fd97ae50ae0a748cb5a2cf2e040`.

## Device-notification startup path

At startup the binary calls `RegisterDeviceNotificationW` from the call whose
return address is runtime VA `0x0100fbdf`:

```text
RegisterDeviceNotificationW(0x00010001, 0x080ffca8, 0x00000000)
```

`0x10001` is its live top-level `MPlayer` window. The 32 bytes at the filter
pointer decode as `DEV_BROADCAST_DEVICEINTERFACE_W`: size 32, type
`DBT_DEVTYP_DEVICEINTERFACE`, reserved zero, and class GUID
`{6994AD04-93EF-11D0-A3CC-00A0C9223196}`. Microsoft identifies that GUID as
`KSCATEGORY_AUDIO`, the kernel-streaming functional category for audio devices.
The flags value zero is `DEVICE_NOTIFY_WINDOW_HANDLE`.

Before the owned-notification implementation, API id 1612 returned `NULL`
unconditionally. The binary therefore never held an `HDEVNOTIFY`, while API id
1613 `UnregisterDeviceNotification` separately reported success for arbitrary
values. The focused authentic regression compiles the current source into a
temporary wasm, reaches this exact call, and checks the post-call EAX at
`0x0100fbdf` for the private generation-tagged handle namespace.

The browser bridge snapshots `navigator.mediaDevices.enumerateDevices()` and
only emits later audio additions/removals. It does not manufacture a startup
arrival. Matching registrations receive `WM_DEVICECHANGE` with
`DBT_DEVICEARRIVAL` or `DBT_DEVICEREMOVECOMPLETE` and a guest-readable
`DEV_BROADCAST_DEVICEINTERFACE_W` payload.

Official references:

- [RegisterDeviceNotificationW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerdevicenotificationw)
- [UnregisterDeviceNotification](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-unregisterdevicenotification)
- [DEV_BROADCAST_DEVICEINTERFACE_W](https://learn.microsoft.com/en-us/windows/win32/api/dbt/ns-dbt-dev_broadcast_deviceinterface_w)
- [KSCATEGORY_AUDIO](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/kscategory-audio)
- [WM_DEVICECHANGE](https://learn.microsoft.com/en-us/windows/win32/devio/wm-devicechange)

The current Microsoft pages list Windows XP as the minimum supported client;
this is therefore a classic Media Player/browser compatibility path in the
repository's `win98-apps` corpus, not evidence that the API shipped in Windows
98 itself.
