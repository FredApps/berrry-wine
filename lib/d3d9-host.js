// WAT owns guest state/resources. This bridge snapshots them into the shared
// neutral command stream; the selected direct WebGL executor sees no pointers.
// First correctness migration: finish every issued GPU command before returning
// to WAT. This is intentionally slower than future fenced asynchronous batching,
// but submitted/consumed/completed never misrepresent GL issue as GPU completion.
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./d3d9-backend') : root.D3D9Backend,
    node ? require('./d3d9-texture') : root.D3D9Texture,
    node ? require('./d3d-shader-ir') : root.D3DShaderIR,
    node ? require('./d3d-command-stream') : root.D3DCommandStream,
    () => node ? require('./d3d9-software-backend') : root.D3D9SoftwareBackend);
  if (node) module.exports = api; else root.D3D9Host = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Backend, Texture, ShaderIR, Stream, getSoftwareBackend) {
  'use strict';
  class Bridge {
    constructor(options) {
      this.options = options; this.devices = new Map(); this.lastError = null;
      this.backend = options.backend || 'webgl';
      if (!['software', 'webgl'].includes(this.backend)) throw new Error('invalid D3D9 backend selection');
      this.asyncSoftware = this.backend === 'software' && !!options.createSoftwareWorker;
      this.requests = new Map(); this.nextRequest = -2; this.closed = false;
      this.deviceGenerations = new Map();
      this.presentWaits = new Set();
      this.maxRequests = options.maxPendingRequests === undefined ? 256 : options.maxPendingRequests;
      if (!Number.isSafeInteger(this.maxRequests) || this.maxRequests < 1) throw new Error('invalid D3D9 pending request limit');
    }
    _worker() {
      if (!this.workerReady) this.workerReady = Promise.resolve().then(() => this.options.createSoftwareWorker())
        .then(async consumer => { this.workerConsumer = consumer; await consumer.ready; return consumer; });
      return this.workerReady;
    }
    _error(error) {
      this.lastError = error;
      if (this.options.onError) this.options.onError(error);
      return -1;
    }
    // Readiness is separate from consuming the result. In particular Present's
    // canonical copy occurs on the resumed guest call, never in an RPC callback.
    wait(token) { return this.requests.get(token | 0)?.ready || Promise.resolve(); }
    _presentBoundary(entry) {
      // The emulated display advances on browser composition frames, or on a
      // virtual60Hz display in the headless host. This is not a GPU fence.
      return new Promise((resolve,reject)=>{
        const raf=typeof requestAnimationFrame==='function';
        const record={cancel:null};
        let id;
        const done=timestamp=>{
          // A faster host monitor must not turn the advertised60Hz guest mode
          // into multiple presents in one emulated refresh period.
          const now=raf?timestamp:Date.now(),tick=Math.floor(now*60/1000);
          if(raf&&entry.presentTick===tick&&!this.closed){id=requestAnimationFrame(done);return;}
          entry.presentTick=tick;this.presentWaits.delete(record);
          this.closed?reject(new Error('D3D9 bridge closed')):resolve();
        };
        id=raf?requestAnimationFrame(done):setTimeout(done,Math.ceil(1000/60));
        record.cancel=()=>{raf?cancelAnimationFrame(id):clearTimeout(id);this.presentWaits.delete(record);reject(new Error('D3D9 presentation cancelled'));};
        this.presentWaits.add(record);
      });
    }
    _consume(entry,command,execute) {
      if(command.opcode!==Stream.OPCODES.PRESENT||command.payload.interval===0x80000000)return execute(command);
      const interval=command.payload.interval;
      if(interval!==0&&interval!==1)throw new Error('unsupported D3D9 presentation interval');
      const result=this._presentBoundary(entry).then(()=>execute(command));
      const value=result.then(r=>r.value);value.catch(()=>{});
      return {consumed:result.then(r=>r.consumed),completion:result.then(r=>r.complete?undefined:r.completion),value};
    }
    _result(entry, value, finalize = () => 1, allowLost = false) {
      if (!value || typeof value.then !== 'function') return finalize(value);
      if (this.nextRequest < -0x80000000) throw new Error('D3D9 request token space exhausted');
      const token = this.nextRequest--;
      let consumed;
      const record = { entry, generation: entry.queue.generation, done: false, finalize, allowLost,
        consumed: new Promise(resolve => { consumed = resolve; }), consume: () => consumed() };
      record.ready = Promise.resolve(value).then(result => { record.value = result; }, error => { record.error = error; })
        .then(() => { record.done = true; });
      this.requests.set(token, record);
      return token;
    }
    _poll(token) {
      const record = this.requests.get(token | 0);
      if (!record) return -1;
      if (!record.done) return token | 0;
      this.requests.delete(token | 0);
      try {
        if (record.error) throw record.error;
        if (this.closed || record.entry.dead || (record.entry.lost && !record.allowLost) || record.entry.queue.generation !== record.generation)
          throw new Error('stale D3D9 render completion');
        return record.finalize(record.value);
      } catch (error) { return this._error(error); }
      finally { record.consume(); }
    }
    _retireFailedWorker() {
      if (!this.workerRetirement) {
        // A poisoned stream cannot be reset behind the worker's live device.
        // Retire the shared worker instead, explicitly losing every device.
        this.workerDead = true;
        for (const entry of this.devices.values()) entry.lost = true;
        this.workerRetirement = this._worker().then(consumer => consumer.cancel(0,
          new Error('D3D9 worker retired after device failure')));
      }
      return this.workerRetirement;
    }
    async close() {
      this.closed = true;
      for(const wait of this.presentWaits)wait.cancel();
      // Cancellation must not publish a queued Present into a retired guest.
      for (const record of this.requests.values()) record.consume();
      try {
        if (this.workerReady) {
          try { await this._worker(); } catch (_) { /* transport owns init failure */ }
          if (this.workerConsumer) await this.workerConsumer.cancel(0, new Error('D3D9 bridge closed'));
        }
      } finally {
        for (const entry of this.devices.values()) {entry.dead = true;entry.queryResults?.clear();}
        this.requests.clear();
      }
    }
    _capacity() { return this.options.commandCapacityBytes === undefined ? 64 * 1024 * 1024 : this.options.commandCapacityBytes; }
    _finish(device) {
      if (device.gpu.gl.isContextLost()) throw new Error('D3D9 GPU context lost');
      device.gpu.finish();
      if (device.gpu.gl.isContextLost()) throw new Error('D3D9 GPU context lost');
    }
    _execute(entry, command) {
      if (entry.kind === 'software') return entry.device.execute(command);
      const op = Stream.OPCODES, p = command.payload;
      let value = 1;
      if (command.opcode === op.RESOURCE_RELEASE) {
        if(p.kind==='color-set') {
          for(const id of p.ids)entry.device.releaseColor(id);
          this._finish(entry.device);
          return {value:1,complete:true};
        }
        if(p.kind==='color') {
          entry.device.releaseColor(p.id);
          this._finish(entry.device);
          return {value:1,complete:true};
        }
        if(p.kind==='depth') {
          entry.device.releaseDepth(p.id);
          this._finish(entry.device);
          return {value:1,complete:true};
        }
        if(p.kind!=='device')throw new Error('unsupported WebGL resource release kind');
        // Context loss has already retired GPU work; otherwise destruction must
        // wait for all prior commands before reclaiming backend resources.
        if (!entry.device.gpu.gl.isContextLost()) this._finish(entry.device);
        entry.device.destroy();
        return { value, complete: true };
      }
      try {
        if (command.opcode === op.RESOURCE_UPDATE && p.kind==='reset') entry.device.reset(p);
        else if (command.opcode === op.RESOURCE_CREATE && p.kind==='color') entry.device.createColor(p.resource,p.pixels,p.pitch);
        else if (command.opcode === op.RESOURCE_UPDATE && p.kind==='color') entry.device.updateColor(p.resource,p.pixels,p.pitch,p.rect);
        else if (command.opcode === op.READBACK) value=entry.device.readColor(p.resource||null);
        else if (command.opcode === op.CLEAR) entry.device.clear(p.color, p.flags,p.depth,p.rects,p.depthAttachment,p.stencil,p.colorAttachment);
        else if (command.opcode === op.DRAW) entry.device.draw(p);
        else if (command.opcode === op.PRESENT) {
          const {pixels}=entry.device.readColor(null);
          value = { pixels, canvas: entry.device.present() };
        } else if (command.opcode !== op.FENCE) throw new Error('unsupported D3D9 render command');
      } catch (error) {
        // Synchronous validation failures still return INVALIDCALL to this API,
        // not a deferred device fault. Any partial backend work is retired first.
        value = { error };
      }
      this._finish(entry.device);
      return { value, complete: true };
    }
    _submit(entry, opcode, payload) {
      const receipt = entry.queue.submit(opcode, payload);
      if (entry.async || receipt.status !== 'completed') return entry.queue.fence(receipt.sequence, receipt.generation).then(async () => {
        const value = await receipt.value;
        if (value && value.error) throw new Error(String(value.error));
        return value;
      });
      if (receipt.value && receipt.value.error) throw receipt.value.error;
      return receipt.value;
    }
    _queryIssue(entry,id,begin){
      if(entry.kind!=='software'||entry.dead||entry.lost||entry.releasing)throw new Error('query device unavailable');
      if(!Number.isInteger(id)||id<1||id>0xffffffff)throw new Error('invalid query identity');
      const queries=entry.queryResults||(entry.queryResults=new Map());
      if(!queries.has(id)&&queries.size>=4096)throw new Error('query capacity exhausted');
      if(!begin&&!queries.has(id))throw new Error('query has no begin');
      const result=this._submit(entry,begin?Stream.OPCODES.QUERY_BEGIN:Stream.OPCODES.QUERY_END,{queryId:id});
      const record={building:begin,done:false,generation:entry.queue.generation};queries.set(id,record);
      const complete=value=>{if(queries.get(id)===record){record.value=value;record.done=true;}};
      const fail=error=>{if(queries.get(id)===record){record.error=error;record.done=true;}};
      if(result&&typeof result.then==='function')result.then(complete,fail);else complete(result);
      return 1;
    }
    call(opcode, address, aux) {
      if (opcode === 0x30007) return this._poll(aux);
      if (this.closed) return -1;
      if(opcode===0x3000a)return this.backend==='software'&&this.options.enableProgrammable&&
        typeof this.options.getExports?.()?.d3d_software_samples==='function'?1:0;
      // Query operations have their own bounded result table and never allocate
      // a parked-render token. In particular polling/release must remain usable
      // when unrelated render callers occupy every token slot.
      if (this.requests.size >= this.maxRequests &&
          opcode !== 0x30005 && !(opcode>=0x3000b&&opcode<=0x3000e))
        return this._error(new Error('D3D9 pending request capacity exhausted'));
      if(opcode===0x30006) {
        try {
          // All CPU submissions precede this synchronous broker operation.
          // No GPU entry means this device has only completed CPU work.
          const entry=this.devices.get(aux>>>0);
          if(entry) return this._result(entry, this._submit(entry, Stream.OPCODES.FENCE, { kind: 'event' }));
          return 1;
        } catch(error) {this.lastError=String(error);return 0;}
      }
      if(opcode===0x30005) {
        if(!this.options.enableProgrammable)return 0;
        if(this.backend==='software') {
          const e=this.options.getExports?.();
          return getSoftwareBackend() && e?.d3d_software_create && e?.d3d_shader_vm_compile ? 1 : 0;
        }
        if(typeof document==='undefined')return 0;
        if(this.probed===undefined)this.probed=Backend.probe(document.createElement('canvas'));
        return this.probed?1:0;
      }
      const memory = this.options.getMemory(), view = new DataView(memory);
      const u32 = offset => view.getUint32(offset, true);
      const g2w = pointer => this.options.guestToWasm(pointer);
      if(opcode===0x3000d||opcode===0x3000e){
        try{
          const entry=this.devices.get(u32(address+8)),id=aux>>>0;
          if(opcode===0x3000e){
            if(!entry)return 1;
            entry.queryResults?.delete(id);
            const result=this._submit(entry,Stream.OPCODES.RESOURCE_RELEASE,{kind:'query',queryId:id});
            if(result&&typeof result.then==='function')result.catch(error=>{entry.lost=true;this._error(error);});
            return 1;
          }
          const record=entry?.queryResults?.get(id);
          if(!record||record.building||entry.dead||entry.lost||record.generation!==entry.queue.generation)
            throw new Error('query result unavailable');
          if(!record.done)return 0;
          if(record.error)throw record.error;
          if(!Number.isInteger(record.value?.samplesLow))throw new Error('invalid query sample result');
          view.setUint32(address+32,record.value.samplesLow,true);return 1;
        }catch(error){return this._error(error);}
      }
      if(opcode===0x30009){
        try{
          const entry=this.devices.get(aux>>>0);if(!entry)return 1;
          const p=u32(address+12),depth=p?g2w(p):0;
          const depthAttachment=depth?{id:u32(depth+36),width:u32(depth+20),height:u32(depth+24),format:u32(depth+28)}:null;
          const nextWindow=entry.kind==='webgl'?this.options.renderer?.()?.windows?.[u32(address+48)]:null;
          if(entry.kind==='webgl'&&!nextWindow)throw new Error('invalid Reset device window');
          return this._result(entry,this._submit(entry,Stream.OPCODES.RESOURCE_UPDATE,
            {kind:'reset',width:u32(address+32),height:u32(address+36),depthAttachment}),
            ()=>{
              entry.queryResults?.clear();
              entry.colors?.clear();
              if(nextWindow&&entry.win!==nextWindow){
                if(entry.win?._gpuFrameLayer===entry.layer)entry.win._gpuFrameLayer=null;
                if(entry.win?._dxFrameLayer===entry.layer)entry.win._dxFrameLayer=null;
                entry.win=nextWindow;
              }
              return 1;
            });
        }catch(error){return this._error(error);}
      }
      if(opcode===0x30013){
        try{
          const entry=this.devices.get(aux>>>0);if(!entry)return 1;
          const kind=u32(address+12),levels=u32(address+32),base=g2w(u32(address+56));
          if(![3,5].includes(kind)||!levels||levels>12||u32(address+8)!==(aux>>>0)||base<256)
            throw new Error('invalid color texture retirement');
          const count=levels*(kind===5?6:1),ids=[];
          if(base+count*80>memory.byteLength)throw new Error('invalid color texture storage extent');
          for(let i=0;i<count;i++){
            const id=u32(base+i*80+36);
            if(entry.colors?.has(id))ids.push(id);
          }
          if(!ids.length)return 1;
          const submitted=this._submit(entry,Stream.OPCODES.RESOURCE_RELEASE,{kind:'color-set',ids});
          for(const id of ids)entry.colors.delete(id);
          if(submitted&&typeof submitted.then==='function')submitted.catch(error=>{this.lastError=error;});
          return 1;
        }catch(error){return this._error(error);}
      }
      if(opcode===0x30008||opcode===0x3000f){
        try{
          const entry=this.devices.get(aux>>>0);if(!entry)return 1;
          const color=opcode===0x3000f,id=u32(address+36);
          if(color&&!entry.colors?.has(id))return 1;
          const submitted=this._submit(entry,Stream.OPCODES.RESOURCE_RELEASE,{kind:color?'color':'depth',id});
          if(color)entry.colors.delete(id);
          if(submitted&&typeof submitted.then==='function')submitted.catch(error=>{this.lastError=error;});
          return 1;
        }catch(error){return this._error(error);}
      }
      if(opcode===0x30010||opcode===0x30011){
        try{
          const entry=this.devices.get(aux>>>0),id=u32(address+36);
          if(!entry||!entry.colors?.has(id))return 1;
          if(u32(address+12)!==0xd3d90006||u32(address+8)!==(aux>>>0))throw new Error('invalid color surface');
          const resource={id,width:u32(address+20),height:u32(address+24),format:u32(address+28)};
          const pitch=u32(address+48),size=u32(address+52),wa=g2w(u32(address+40));
          if(pitch!==resource.width*4||size!==pitch*resource.height||wa<256||wa+size>memory.byteLength)
            throw new Error('invalid canonical color range');
          if(opcode===0x30011)return this._result(entry,this._submit(entry,Stream.OPCODES.RESOURCE_UPDATE,
            {kind:'color',resource,pitch,pixels:new Uint8Array(memory,wa,size).slice()}));
          return this._result(entry,this._submit(entry,Stream.OPCODES.READBACK,{resource}),result=>{
            if(result.pixels.length!==size)throw new Error('color readback size mismatch');
            new Uint8Array(memory,wa,size).set(result.pixels);return 1;
          });
        }catch(error){return this._error(error);}
      }
      if(opcode===0x30016){
        try{
          const id=u32(address),width=u32(address+12),height=u32(address+16),bits=u32(address+8),size=width*height*4;
          if(!width||!height||width>4096||height>4096||bits<256||bits+size>memory.byteLength)throw new Error('invalid DC backbuffer range');
          const entry=this.devices.get(id);if(!entry)return 1;
          if(entry.releasing)throw new Error('DC acquire on releasing device');
          return this._result(entry,this._submit(entry,Stream.OPCODES.READBACK,{}),result=>{
            if(result.pixels.length!==size)throw new Error('DC readback size mismatch');
            new Uint8Array(memory,bits,size).set(result.pixels);return 1;
          });
        }catch(error){return this._error(error);}
      }
      if(opcode===0x30012){
        try{
          const id=u32(address),width=u32(address+12),height=u32(address+16),p=aux>>>0;
          if(u32(p+12)!==0xd3d90006||u32(p+8)!==id||u32(p+20)!==width||u32(p+24)!==height||u32(p+28)!==22)
            throw new Error('invalid backbuffer readback destination');
          const target=new Uint8Array(memory,g2w(u32(p+40)),width*height*4),entry=this.devices.get(id);
          if(!entry){target.set(new Uint8Array(memory,u32(address+8),target.length));return 1;}
          return this._result(entry,this._submit(entry,Stream.OPCODES.READBACK,{}),result=>{
            if(result.pixels.length!==target.length)throw new Error('backbuffer readback size mismatch');
            target.set(result.pixels);return 1;
          });
        }catch(error){return this._error(error);}
      }
      if (opcode === 0x30004) {
        try {
        const entry = this.devices.get(aux >>> 0);
        if (entry) {
          if (entry.releasing) throw new Error('D3D9 device release already pending');
          if (!entry.async && entry.queue.error && !entry.queue.inflight) entry.queue.reset();
          // A prior Present may have finished rendering but still be waiting
          // for its guest to consume/copy. Keep native teardown parked until
          // those continuations have run, so their target cannot be freed.
          const prior = [...this.requests.values()].filter(r => r.entry === entry).map(r => r.consumed);
          let released;
          if (entry.async && (entry.queue.error || entry.lost)) released = this._retireFailedWorker();
          else {
            released = this._submit(entry, Stream.OPCODES.RESOURCE_RELEASE, { kind: 'device' });
            if (entry.async) released = released.catch(() => this._retireFailedWorker());
          }
          entry.releasing = true;
          if (entry.async || prior.length) released = Promise.all([released, ...prior]);
          return this._result(entry, released, () => {
          if (entry.win && entry.win._gpuFrameLayer === entry.layer) entry.win._gpuFrameLayer = null;
          if (entry.win && entry.win._dxFrameLayer === entry.layer) entry.win._dxFrameLayer = null;
          this.devices.delete(aux >>> 0);
          entry.dead = true;
          return 1;
          }, true);
        }
        return 1;
        } catch (error) { return this._error(error); }
      }
      try {
        const id = u32(address), program = g2w(u32(address+4)), hwnd = u32(address+20);
        let width = u32(address+12), height = u32(address+16);
        let entry = this.devices.get(id);
        if (entry?.releasing) throw new Error('D3D9 device is being released');
        if (this.asyncSoftware && this.workerDead) throw new Error('D3D9 software worker was lost');
        if (!entry && opcode !== 0x30001 && opcode !== 0x30003 && opcode !== 0x3000b && opcode !== 0x3000c && opcode !== 0x30014 && opcode !== 0x30015) return 0;
        if (!entry) {
          const renderer = this.options.renderer?.();
          const win = renderer && renderer.windows?.[hwnd];
          if (this.asyncSoftware) {
            entry = {kind:'software', async:true, win:null, layer:null};
          } else if (this.backend === 'software') {
            const Software = getSoftwareBackend();
            if (!Software) throw new Error('D3D9 software backend is unavailable');
            const device = new Software.Device({getExports:this.options.getExports,
              getMemory:this.options.getMemory, width, height});
            entry = {device, kind:'software', win:null, layer:null};
          } else {
          if (!win || typeof document === 'undefined') throw new Error('D3D9 requires a GPU window');
          if (!width || !height || width > 4096 || height > 4096) throw new Error('invalid GPU target size');
          // The compositor requires the window's normal backing surface even
          // for a GPU-only client that never opens a GDI DC. Reuse its owner;
          // do not substitute the GPU context canvas for a window surface.
          if (renderer.getWindowCanvas) renderer.getWindowCanvas(hwnd);
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const device = new Backend.Device(canvas);
          const layer = { canvas: device.gpu.getPresentationSurface(), backend: device.gpu, writeSeq: 0, kind: 'gpu' };
          entry = { device, layer, win, kind:'webgl' };
          }
          const generation = (this.deviceGenerations.get(id) || 0) + 1;
          this.deviceGenerations.set(id, generation);
          const execute=entry.async ? command => {
              const result = this._worker().then(consumer => consumer.execute(command));
              const value = result.then(r=>r.value); value.catch(() => {});
              return { consumed:result.then(r=>r.consumed), completion:result.then(r=>r.completion), value };
            } : command => this._execute(entry, command);
          entry.queue = new Stream.CommandQueue({ deviceId: id, generation, capacityBytes: this._capacity(),
            consumer:{execute:command=>this._consume(entry,command,execute)} });
          this.devices.set(id, entry);
          if (entry.async) this._submit(entry, Stream.OPCODES.RESOURCE_CREATE,
            {kind:'device',width,height,quadBudget:this.options.softwareQuadBudget}).catch(() => {});
          const color = opcode===0x30003?0:u32(program+1688);
          const initialized = this._submit(entry, Stream.OPCODES.CLEAR, {
            color: [((color>>>16)&255)/255,((color>>>8)&255)/255,(color&255)/255,(color>>>24)/255], flags: 3 });
          if (entry.async) initialized.catch(() => {});
        }
        if(opcode===0x3000b||opcode===0x3000c)return this._queryIssue(entry,aux>>>0,opcode===0x3000b);
        const { device, win, layer } = entry;
        const ensureColor=p=>{
          if(p<256||p+80>memory.byteLength||u32(p+12)!==0xd3d90006||u32(p+8)!==id||u32(p+56))
            throw new Error('invalid or locked D3D9 color storage');
          const resource={id:u32(p+36),width:u32(p+20),height:u32(p+24),format:u32(p+28)};
          if(!entry.colors)entry.colors=new Set();
          if(!entry.colors.has(resource.id)){
            const pitch=u32(p+48),size=u32(p+52),bits=g2w(u32(p+40));
            if(!resource.id||!resource.width||!resource.height||pitch!==resource.width*4||size!==pitch*resource.height||bits<256||bits+size>memory.byteLength)
              throw new Error('invalid canonical color storage extent');
            const created=this._submit(entry,Stream.OPCODES.RESOURCE_CREATE,{kind:'color',resource,
              pitch,pixels:new Uint8Array(memory,bits,size).slice()});
            if(created&&typeof created.then==='function')created.catch(error=>{this.lastError=String(error);});
            entry.colors.add(resource.id);
          }
          return resource;
        };
        if(opcode===0x30015){
          const pointer=u32(address+24),resource=pointer?ensureColor(g2w(pointer)):null,bits=u32(address+28),sourcePitch=u32(address+32);
          const target=resource??{width,height,format:22};
          const rect={x:u32(address+36),y:u32(address+44),width:u32(address+48),height:u32(address+52)};
          if(!rect.width||!rect.height||rect.x>target.width||rect.y>target.height||
            rect.width>target.width-rect.x||rect.height>target.height-rect.y||u32(address+56)!==target.format||
            sourcePitch<rect.width*4||bits<256||bits+(rect.height-1)*sourcePitch+rect.width*4>memory.byteLength)
            throw new Error('invalid UpdateSurface upload');
          const pitch=rect.width*4,pixels=new Uint8Array(pitch*rect.height);
          for(let y=0;y<rect.height;y++)pixels.set(new Uint8Array(memory,bits+y*sourcePitch,pitch),y*pitch);
          return this._result(entry,this._submit(entry,Stream.OPCODES.RESOURCE_UPDATE,{kind:'color',resource,rect,pitch,pixels}));
        }
        if(opcode===0x30014){
          const pointer=u32(address+24),color=u32(address+28);
          const colorAttachment=pointer?ensureColor(g2w(pointer)):undefined;
          const rect=[u32(address+32),u32(address+36),u32(address+44),u32(address+48)];
          const w=colorAttachment?.width??width,h=colorAttachment?.height??height;
          if(rect[0]>=rect[2]||rect[1]>=rect[3]||rect[2]>w||rect[3]>h)throw new Error('invalid ColorFill rectangle');
          return this._result(entry,this._submit(entry,Stream.OPCODES.CLEAR,{
            color:[((color>>>16)&255)/255,((color>>>8)&255)/255,(color&255)/255,(color>>>24)/255],
            flags:1,rects:[rect],depthAttachment:null,colorAttachment}));
        }
        let colorAttachment;
        const colorPointer=u32(program+22020);
        if(colorPointer&&opcode!==0x30002){
          const p=g2w(colorPointer);
          colorAttachment=ensureColor(p);
          width=colorAttachment.width;height=colorAttachment.height;
        }
        const depthPointer=u32(program+21752);
        const depthAttachment=depthPointer?(()=>{
          const p=g2w(depthPointer);
          if(u32(p+12)!==0xd3d90005||u32(p+8)!==id)throw new Error('invalid D3D9 depth attachment identity');
          return {id:u32(p+36),width:u32(p+20),height:u32(p+24),format:u32(p+28)};
        })():null;
        const outputState=g2w(u32(address+40));
        const scissor=u32(outputState+256+174*4)?{
          enabled:true,
          left:u32(program+22016)?view.getInt32(program+22000,true):0,
          top:u32(program+22016)?view.getInt32(program+22004,true):0,
          right:u32(program+22016)?view.getInt32(program+22008,true):width,
          bottom:u32(program+22016)?view.getInt32(program+22012,true):height,
        }:undefined;
        if(opcode!==0x30002&&scissor&&(scissor.left<0||scissor.top<0||scissor.right<scissor.left||
          scissor.bottom<scissor.top||scissor.right>width||scissor.bottom>height))
          throw new Error('invalid D3D9 scissor rectangle');
        if (opcode === 0x30002) {
          // Publish and synchronize canonical guest-visible back-buffer bytes
          // at the explicit present boundary; never expose a half-built frame.
          const dest = new Uint8Array(memory, u32(address+8), width*height*4);
          const completed = this._submit(entry, Stream.OPCODES.PRESENT, { width, height, interval:u32(program+21784) });
          return this._result(entry, completed, completed => {
          dest.set(completed.pixels);
          // Return to the existing WAT dx_present path after synchronizing the
          // native target. It already owns CPU presentation and CLI captures.
          if (entry.kind === 'software') return 0;
          layer.canvas = completed.canvas; layer.writeSeq++;
          win._gpuFrameLayer = layer; win._dxFrameLayer = layer;
          if (this.options.onPresent) this.options.onPresent(layer);
          const renderer = this.options.renderer();
          if (renderer.scheduleRepaint) renderer.scheduleRepaint();
          return 1;
          });
        }
        if (opcode === 0x30003) {
          const color = u32(address+48), z = view.getFloat32(address+52,true);
          const count=u32(address+56),ptr=u32(address+60),flags=u32(address+44);
          if(flags>7)throw new Error('invalid D3D9 clear flags');
          if((flags&4)&&depthAttachment?.format!==75)throw new Error('D3D9 stencil clear requires D24S8 attachment');
          if((flags&2)&&(!Number.isFinite(z)||z<0||z>1))throw new Error('invalid D3D9 clear depth');
          if((flags&2)&&!depthAttachment)throw new Error('D3D9 depth clear without attached surface');
          if(!!count!==!!ptr||count>65536)throw new Error('invalid D3D9 clear rectangle count/pointer');
          const vx=u32(program+21736)?u32(program+21728):0,vy=u32(program+21736)?u32(program+21732):0;
          const vw=u32(program+21736)||width,vh=u32(program+21736)?u32(program+21740):height;
          if(!vw||!vh||vx+vw>width||vy+vh>height)throw new Error('invalid D3D9 clear viewport');
          const clip=scissor?[Math.max(vx,scissor.left),Math.max(vy,scissor.top),
            Math.min(vx+vw,scissor.right),Math.min(vy+vh,scissor.bottom)]:[vx,vy,vx+vw,vy+vh];
          const rects=[];
          if(count){
            const p=g2w(ptr),size=count*16;
            if(ptr+size>0x100000000||p<256||p+size>memory.byteLength||g2w(ptr+size-1)!==p+size-1)
              throw new Error('invalid D3D9 clear rectangle range');
            for(let i=0;i<count;i++){
              const at=p+i*16,l=view.getInt32(at,true),t=view.getInt32(at+4,true),r=view.getInt32(at+8,true),b=view.getInt32(at+12,true);
              if(r<l||b<t)throw new Error('invalid D3D9 clear rectangle ordering');
              const clipped=[Math.max(l,clip[0]),Math.max(t,clip[1]),Math.min(r,clip[2]),Math.min(b,clip[3])];
              if(clipped[2]>clipped[0]&&clipped[3]>clipped[1])rects.push(clipped);
            }
          }else if(clip[2]>clip[0]&&clip[3]>clip[1])rects.push(clip);
          return this._result(entry, this._submit(entry, Stream.OPCODES.CLEAR, {
            color: [((color>>>16)&255)/255,((color>>>8)&255)/255,(color&255)/255,(color>>>24)/255], flags,depth:z,stencil:u32(address+24),rects,depthAttachment,colorAttachment }));
        }
        const declaration=u32(program+8), fvf = u32(program+12);
        const position=fvf&0x400e,texCount=(fvf>>>8)&15;
        if (!declaration && (![2,4,0x4002].includes(position) || texCount>6 || (fvf&0xb001)))
          throw new Error(`D3D9 FVF ${fvf.toString(16)} is not implemented`);
        const primitive = u32(address+24), primitiveCount = u32(address+28), stride = u32(address+36);
        const count = Backend.primitiveVertices(primitive, primitiveCount), byteCount = count*stride;
        if (!stride || stride>255 || !Number.isSafeInteger(byteCount) || byteCount>0x10000000)
          throw new Error('invalid D3D9 draw byte range');
        // Preflight the large allocations before copying/decoding guest bytes.
        // CommandQueue independently bounds the complete serialized descriptor,
        // including its object overhead, before publishing anything to WebGL.
        let snapshotBytes = 4096;
        const reserve = bytes => {
          if (!Number.isSafeInteger(bytes) || bytes < 0 || snapshotBytes + bytes > this._capacity())
            throw new Error('D3D9 draw snapshot exceeds command byte budget');
          snapshotBytes += bytes;
        };
        const shader = offset => {
          if (!u32(program+offset)) return null;
          const ptr = g2w(u32(program+offset)), length = u32(ptr+16);
          if (!length || length%4 || length>262144) throw new Error('invalid shader resource');
          reserve(length * 32); // worst-case native 128-byte IR record per token
          const ex = this.options.getExports?.();
          if (ex?.d3d_shader_ir_compile) {
            if (!ShaderIR) throw new Error('D3D shader IR reader is unavailable');
            if (!this.shaderCompiler) this.shaderCompiler = new ShaderIR.Compiler({
              getExports:this.options.getExports,getMemory:this.options.getMemory });
            // Creation owns a validated serialized IR tail in the same native
            // allocation as GetFunction tokens. Draw never reparses tokens.
            return this.shaderCompiler.retained(ptr+24+length,length/4);
          }
          throw new Error('native shader IR validator unavailable');
        };
        const state = g2w(u32(address+40));
        const rs = id => u32(state+256+id*4);
        let vertices, indices, vertexCount=count;
        const indexPointer=u32(address+44), vertexPointer=u32(address+32);
        if(indexPointer) {
          const format=u32(address+48), min=u32(address+52), num=u32(address+56), end=min+num;
          if(![101,102].includes(format) || !num || end>0x100000000)
            throw new Error('invalid indexed vertex range');
          const indexBytes=format===101?2:4, start=g2w(indexPointer);
          if(start===0xf0 || start+count*indexBytes>memory.byteLength)
            throw new Error('invalid index memory range');
          reserve(count * 4);
          const values=new Uint32Array(count);
          for(let i=0;i<count;++i) {
            const value=indexBytes===2?view.getUint16(start+i*2,true):u32(start+i*4);
            if(value<min || value>=end)throw new Error('index outside declared vertex range');
            values[i]=value;
          }
          // INDEX32 needs no WebGL extension: expand the referenced vertices
          // without truncating indices. INDEX16 retains the indexed GPU path.
          if(format===102) {
            reserve(byteCount);
            vertices=new Uint8Array(byteCount);
            for(let i=0;i<count;++i) {
              const p=vertexPointer+values[i]*stride;
              if(p+stride>0x100000000 || g2w(p)===0xf0)throw new Error('vertex address overflow/unmapped');
              vertices.set(new Uint8Array(memory,g2w(p),stride),i*stride);
            }
          } else {
            vertexCount=num;
            const p=vertexPointer+min*stride, length=num*stride;
            if(length>0x10000000 || p+length>0x100000000 || g2w(p)===0xf0)
              throw new Error('invalid indexed vertex bytes');
            reserve(length + count * 2);
            vertices=new Uint8Array(memory,g2w(p),length).slice();
            indices=Uint16Array.from(values,value=>value-min);
          }
        } else { reserve(byteCount); vertices=new Uint8Array(memory,g2w(vertexPointer),byteCount).slice(); }
        const attributes=[],convertedColors=new Set();
        const convertColor=offset=>{
          if(offset+4>stride)throw new Error('color outside vertex stride');
          if(convertedColors.has(offset))return;
          convertedColors.add(offset);
          for(let i=0;i<vertexCount;++i){const p=i*stride+offset;[vertices[p],vertices[p+2]]=[vertices[p+2],vertices[p]];}
        };
        if(declaration) {
          const ptr=g2w(declaration),bytes=u32(ptr+16),seen=new Set();
          if(bytes<16 || bytes>136 || bytes%8)throw new Error('invalid vertex declaration length');
          for(let i=0;i<bytes/8-1;++i) {
            const p=ptr+24+i*8,offset=view.getUint16(p+2,true),type=view.getUint8(p+4),
              usage=view.getUint8(p+6),usageIndex=view.getUint8(p+7),key=`${usage}:${usageIndex}`;
            if(view.getUint16(p,true)!==0 || type>4 || view.getUint8(p+5)!==0 || seen.has(key))
              throw new Error('unsupported/duplicate vertex declaration element');
            seen.add(key);
            attributes.push({register:i,usage,usageIndex,type,offset});
            if(type===4)convertColor(offset);
          }
        } else {
        attributes.push({register:0,usage:position===4?9:0,usageIndex:0,type:position===2?2:3,offset:0});
        let offset=position===2?12:16;
        if(fvf&16){attributes.push({register:3,usage:3,usageIndex:0,type:2,offset});offset+=12;}
        if(fvf&32){attributes.push({register:4,usage:4,usageIndex:0,type:0,offset});offset+=4;}
        for(const [bit,register,index] of [[64,5,0],[128,6,1]]) if(fvf&bit) {
          attributes.push({register,usage:10,usageIndex:index,type:4,offset});
          convertColor(offset);
          offset+=4;
        }
        for(let i=0;i<texCount;++i){const size=[2,3,4,1][(fvf>>>(16+i*2))&3];
          attributes.push({register:7+i,usage:5,usageIndex:i,type:size-1,offset});offset+=size*4;}
        if(offset>stride)throw new Error('FVF exceeds vertex stride');
        }
        const textures=[];
        for(let stage=0;stage<6;++stage){
          // Stages4/5 are appended; 1716 and2064 belong to other objects.
          const ptr=u32(program+(stage<4?1700+stage*4:21792+(stage-4)*4));if(!ptr)continue;
          const t=g2w(ptr),kind=u32(t+12),levelCount=u32(t+32),format=u32(t+36),lod=u32(t+48),faces=[];
          if(![3,5].includes(kind) || levelCount>12 || lod>=levelCount || ![21,22,62,Texture.DXT1,Texture.DXT5].includes(format))throw new Error('invalid texture resource');
          for(let face=0;face<(kind===5?6:1);++face){
          const levels=[];
          for(let level=lod;level<levelCount;++level){const m=t+64+(face*levelCount+level)*32,w=u32(m),h=u32(m+4);
            if(u32(m+20))throw new Error('cannot draw from locked texture');
            if(u32(t+56)){
              const p=g2w(u32(t+56))+(face*levelCount+level)*80;
              const resource=ensureColor(p);
              if(resource.width!==w||resource.height!==h||resource.format!==format||u32(p+72)!==ptr||u32(p+76)!==face*levelCount+level)
                throw new Error('invalid texture color alias');
              if(resource.id===colorAttachment?.id)throw new Error('D3D9 render-target texture feedback is unsupported');
              reserve(128);
              levels.push({width:w,height:h,resource});
              continue;
            }
            reserve(w * h * 4);
            const src=new Uint8Array(memory,g2w(u32(m+16)),u32(m+12));
            let pixels;
            if(format===Texture.DXT1||format===Texture.DXT5)pixels=Texture.decode(src,w,h,format);
            else{
              if(src.length!==w*h*4)throw new Error('invalid texture byte length');
              pixels=new Uint8Array(src.length);
              if(format===62)pixels.set(src); // retain signed U/V and unsigned L bytes
              else for(let i=0;i<src.length;i+=4){pixels[i]=src[i+2];pixels[i+1]=src[i+1];pixels[i+2]=src[i];pixels[i+3]=format===22?255:src[i+3];}
            }
            levels.push({width:w,height:h,pixels});
          }
          faces.push({...levels[0],levels});
          }
          const s=program+(stage<4?1808+stage*64:21800+(stage-4)*64);
          const lodBias=new DataView(memory).getFloat32(s+32,true);
          if(!Number.isFinite(lodBias))throw new Error(`nonfinite sampler LOD bias for stage ${stage}`);
          textures[stage]={...faces[0],originalWidth:u32(t+24),originalHeight:u32(t+28),baseLOD:lod,
            ...(format===62?{format}:{}),...(kind===5?{faces}:{}),sampler:{addressU:u32(s+4),addressV:u32(s+8),
            borderColor:u32(s+16),mag:u32(s+20),min:u32(s+24),mip:u32(s+28),lodBias,maxMipLevel:u32(s+36)}};
        }
        // Real TSS defaults/state, copied now; asynchronous consumers must not
        // retain a view into mutable guest device state. Values are float bits.
        const bumpStates = [0,1,2,3,4,5].map(stage=>{
          const base=program+20664+stage*132;
          const values=Float32Array.from([7,8,9,10,22,23],id=>new DataView(memory).getFloat32(base+id*4,true));
          if(!values.every(Number.isFinite))throw new Error(`nonfinite bump metadata for stage ${stage}`);
          return values;
        });
        let lightingState;
        if(!u32(program)&&rs(137)){
          const floats=(p,n)=>new Float32Array(memory,p,n).slice();
          const m=program+21928,lights=[],seen=new Set();
          let node=u32(program+21996);
          while(node){
            if(seen.has(node))throw new Error('cyclic native light list');
            seen.add(node);
            const p=g2w(node);
            if(p===0xf0||p+120>memory.byteLength)throw new Error('invalid native light extent');
            if(u32(p+12)){
              reserve(104);
              const l=p+16;
              lights.push({index:u32(p+4),type:u32(l),diffuse:floats(l+4,4),specular:floats(l+20,4),
                ambient:floats(l+36,4),position:floats(l+52,3),direction:floats(l+64,3),
                range:view.getFloat32(l+76,true),falloff:view.getFloat32(l+80,true),
                attenuation0:view.getFloat32(l+84,true),attenuation1:view.getFloat32(l+88,true),
                attenuation2:view.getFloat32(l+92,true),theta:view.getFloat32(l+96,true),phi:view.getFloat32(l+100,true)});
            }
            node=u32(p);
          }
          reserve(68);
          lightingState={material:{diffuse:floats(m,4),ambient:floats(m+16,4),specular:floats(m+32,4),
            emissive:floats(m+48,4),power:view.getFloat32(m+64,true)},lights,
            ambientColor:rs(139),colorVertex:rs(141),diffuseMaterialSource:rs(145),
            specularMaterialSource:rs(146),ambientMaterialSource:rs(147),emissiveMaterialSource:rs(148)};
        }
        const fixedFunction = !u32(program) || !u32(program+4) ? {
          ...lightingState,
          lighting:rs(137),fog:rs(28),specular:rs(29),alphaTest:rs(15),alphaFunc:rs(25),
          alphaRef:rs(24),textureFactor:rs(60),normalizeNormals:rs(143),localViewer:rs(142),
          fogColor:rs(34),fogTableMode:rs(35),fogVertexMode:rs(140),rangeFog:rs(48),
          fogStart:new Float32Array(new Uint32Array([rs(36)]).buffer)[0],
          fogEnd:new Float32Array(new Uint32Array([rs(37)]).buffer)[0],
          fogDensity:new Float32Array(new Uint32Array([rs(38)]).buffer)[0],
          view:new Float32Array(memory,program+2068,16).slice(),
          projection:new Float32Array(memory,program+2068+64,16).slice(),
          world:new Float32Array(memory,program+2068+10*64,16).slice(),
          stages:[0,1,2,3,4,5].map(stage=>{
            const t=program+20664+stage*132;
            return {colorOp:u32(t+4),colorArg1:u32(t+8),colorArg2:u32(t+12),
              alphaOp:u32(t+16),alphaArg1:u32(t+20),alphaArg2:u32(t+24),
              colorArg0:u32(t+104),alphaArg0:u32(t+108),
              transform:new Float32Array(memory,program+2068+(stage+2)*64,16).slice(),
              texCoordIndex:u32(t+44),transformFlags:u32(t+96),resultArg:u32(t+112),constant:u32(t+128)};
          })
        } : undefined;
        const fogState={enabled:rs(28),color:rs(34),tableMode:rs(35),depthMode:0,
          start:new Float32Array(new Uint32Array([rs(36)]).buffer)[0],
          end:new Float32Array(new Uint32Array([rs(37)]).buffer)[0],
          density:new Float32Array(new Uint32Array([rs(38)]).buffer)[0]};
        return this._result(entry, this._submit(entry, Stream.OPCODES.DRAW, { primitive, primitiveCount, stride, fixedFunction,fogState,
          viewport: u32(program+21736) ? {
            x:u32(program+21728),y:u32(program+21732),width:u32(program+21736),height:u32(program+21740),
            minZ:new Float32Array(memory,program+21744,1)[0],maxZ:new Float32Array(memory,program+21748,1)[0]
          } : undefined,
          vertices, indices, attributes, textures, bumpStates,depthAttachment,scissor,colorAttachment,
          vertexShader: shader(0), pixelShader: shader(4),
          vertexConstants: new Float32Array(memory,program+16,384).slice(),
          pixelConstants: new Float32Array(memory,program+1552,32).slice(),
          state: { zenable: !!rs(7), zwrite: !!rs(14), zfunc: rs(23), blend: !!rs(27),
            srcblend: rs(19), dstblend: rs(20), blendop:rs(171),separateAlpha:!!rs(206),
            srcblendalpha:rs(207),dstblendalpha:rs(208),blendopalpha:rs(209),blendFactor:rs(193),
            colorWriteMask:rs(168),cull: rs(22),alphaTest:!!rs(15),alphaFunc:rs(25),alphaRef:rs(24),
            fillMode:rs(8),lastPixel:!!rs(16),antialiasedLine:!!rs(176),
            pointSize:view.getFloat32(state+256+154*4,true),pointSizeMin:view.getFloat32(state+256+155*4,true),
            pointSizeMax:view.getFloat32(state+256+166*4,true),pointSprite:!!rs(156),pointScale:!!rs(157),
            pointScaleA:view.getFloat32(state+256+158*4,true),pointScaleB:view.getFloat32(state+256+159*4,true),pointScaleC:view.getFloat32(state+256+160*4,true),
            stencilEnable:!!rs(52),stencilFail:rs(53),stencilZFail:rs(54),stencilPass:rs(55),stencilFunc:rs(56),
            stencilRef:rs(57),stencilMask:rs(58),stencilWriteMask:rs(59),twoSidedStencil:!!rs(185),
            ccwStencilFail:rs(186),ccwStencilZFail:rs(187),ccwStencilPass:rs(188),ccwStencilFunc:rs(189) } }));
      } catch (error) {
        this.lastError = error;
        if (this.options.onError) this.options.onError(error);
        return -1;
      }
    }
  }
  return { Bridge };
});
