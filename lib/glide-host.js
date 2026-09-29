// Process-owned Glide transport and window presentation. Guest workers call
// this through the ordinary synchronous import broker; a WAT batch is borrowed
// only until submit returns, so the device receives an owned byte snapshot.
(function(root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./gpu-backend') : root.GpuBackend,
    typeof module !== 'undefined' && module.exports ? require('./glide-backend') : root.GlideBackend,
    typeof module !== 'undefined' && module.exports ? require('./glide-software') : root.GlideSoftware);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GlideHost = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(GpuBackend, GlideBackend, GlideSoftware) {
  'use strict';
  class Bridge {
    constructor(options = {}) {
      this.options = options;
      this.device = null;
      this.backend = null;
      this.layer = null;
      this.win = null;
      this.stats = { batches: 0, bytes: 0, presents: 0 };
    }
    _renderer() {
      return typeof this.options.renderer === 'function' ? this.options.renderer() : this.options.renderer;
    }
    _present(frame) {
      const renderer = this._renderer();
      let hwnd = frame.hwnd >>> 0;
      // Glide permits a null window handle. The guest may have created its
      // fullscreen window on a Worker, so use the shared-window-table fallback
      // rather than the page instance's thread-local main HWND.
      if (!hwnd && this.options.getExports) {
        const exports = this.options.getExports();
        if (exports && exports.get_dx_present_hwnd) hwnd = exports.get_dx_present_hwnd() >>> 0;
      }
      const win = renderer && renderer.windows && renderer.windows[hwnd];
      if (!this.layer) this.layer = { kind: 'gpu', canvas: null, backend: this.backend, writeSeq: 0 };
      if (this.win && this.win !== win) this._detach();
      this.win = win || null;
      this.layer.canvas = frame.surface;
      this.layer.writeSeq = renderer && renderer.nextSurfaceWriteSeq
        ? renderer.nextSurfaceWriteSeq() : this.layer.writeSeq + 1;
      if (win) {
        // GPU-only windows still need their ordinary backing surface: the
        // compositor and input viewport derive window geometry from it.
        if (!win._backCanvas && renderer.getWindowCanvas) renderer.getWindowCanvas(hwnd);
        if (win.isChild) win._canonicalOwnSurface = true;
        win._gpuFrameLayer = this.layer;
        win._dxFrameLayer = this.layer;
        if (renderer.scheduleRepaint) renderer.scheduleRepaint();
      }
      this.stats.presents++;
      if (this.options.onPresent) this.options.onPresent(this.layer);
    }
    _detach() {
      if (!this.win) return;
      if (this.win._gpuFrameLayer === this.layer) this.win._gpuFrameLayer = null;
      if (this.win._dxFrameLayer === this.layer) this.win._dxFrameLayer = null;
      const renderer = this._renderer();
      if (renderer && renderer.scheduleRepaint) renderer.scheduleRepaint();
      this.win = null;
    }
    _open(bytes) {
      if (bytes.byteLength < 20) throw new RangeError('Glide open packet is truncated');
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(4, true), height = view.getUint32(8, true);
      if (!width || !height || width > 4096 || height > 4096) return 0;
      if (this.device) throw new Error('Glide context is already open');
      const makeCanvas = this.options.createCanvas || ((w, h) => {
        if (typeof document === 'undefined') return null;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        return canvas;
      });
      const canvas = makeCanvas(width, height);
      if (!canvas) return 0;
      canvas.width = width; canvas.height = height;
      if (this.options.backend === 'software') {
        if (!GlideSoftware) throw new Error('Glide software backend is unavailable');
        this.device = new GlideSoftware.Device({
          canvas,
          getExports: this.options.getExports,
          getMemory: () => {
            const memory = this.options.getMemory();
            return memory.buffer || memory;
          },
          onPresent: frame => this._present(frame),
        });
        try {
          const result = this.device.submit(1, bytes);
          if (!result) this.close();
          return result | 0;
        } catch (error) { this.close(); throw error; }
      }
      try {
        this.backend = this.options.createBackend ? this.options.createBackend(canvas)
          : new GpuBackend.WebGLBackend(canvas);
      } catch (error) {
        if (this.options.onError) this.options.onError(error);
        return 0;
      }
      try {
        const Device = this.options.Device || GlideBackend.Device;
        this.device = new Device({ backend: this.backend, onPresent: frame => this._present(frame) });
        const result = this.device.submit(1, bytes);
        if (!result) this.close();
        return result | 0;
      } catch (error) {
        this.close();
        throw error;
      }
    }
    submit(opcode, pointer, length) {
      const memory = this.options.getMemory();
      const buffer = memory.buffer || memory;
      pointer >>>= 0; length >>>= 0;
      if (pointer > buffer.byteLength || length > buffer.byteLength - pointer)
        throw new RangeError('Glide command packet is outside WASM memory');
      const bytes = new Uint8Array(buffer, pointer, length).slice();
      this.stats.bytes += length;
      if (opcode === 1) return this._open(bytes);
      if (!this.device) throw new Error('Glide command without an open context');
      if (opcode === 0) this.stats.batches++;
      if (opcode === 2) { this.close(); return 1; }
      const result = this.device.submit(opcode, bytes) | 0;
      // Readback is a synchronous barrier. Publish only after the backend
      // completed every earlier draw; borrowed guest storage is still valid.
      if (opcode === 9 && result) new Uint8Array(buffer, pointer, length).set(bytes);
      return result;
    }
    close() {
      const device = this.device, backend = this.backend;
      this.device = null;
      this.backend = null;
      this._detach();
      this.layer = null;
      try { if (device) device.submit(2, new Uint8Array()); }
      finally { if (backend && typeof backend.destroy === 'function') backend.destroy(); }
    }
  }
  return { Bridge };
});
