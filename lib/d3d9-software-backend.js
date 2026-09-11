// D3D9 snapshot adapter to the production WAT shader VM and quad rasterizer.
// JavaScript performs bounded format packing/ownership only: no shader execution,
// triangle coverage, interpolation, depth testing or pixel shading lives here.
(function(root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./d3d-shader-ir') : root.D3DShaderIR,
    node ? require('./d3d-command-stream') : root.D3DCommandStream,
    node ? require('./d3d-geometry-batches') : root.D3DGeometryBatches);
  if (node) module.exports = api; else root.D3D9SoftwareBackend = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(IR, Stream, Geometry) {
  'use strict';
  function invalid(message) { throw new Error(`D3D9 software: ${message}`); }
  class Device {
    constructor(options) {
      this.options = options; this.kind = 'software';
      this.width = options.width; this.height = options.height;
      this.pitch = this.width * 4;
      this.budget = options.maxBytes === undefined ? 64 * 1024 * 1024 : options.maxBytes;
      this.fixedCacheLimit=options.fixedCacheBytes??Math.min(262144,Math.floor(this.budget/16));
      this.fixedCache=0;
      this.quadBudget = options.quadBudget === undefined ? 256 : options.quadBudget;
      // Custom schedulers retain one native step per callback unless opted in.
      // The production render worker supplies a short elapsed-time slice.
      this.sliceMs = options.sliceMs === undefined ? 0 : options.sliceMs;
      this.now = options.now === undefined ? ()=>performance.now() : options.now;
      this.bytes = 0; this.active = null; this.destroyed = false;
      this.completedSamples=0n;this.lastDrawSamples=0n;
      this.queries=new Map();
      this.depthSurfaces=new Map();
      this.colorSurfaces=new Map();
      if (!Number.isInteger(this.width) || this.width < 1 || this.width > 2048
          || !Number.isInteger(this.height) || this.height < 1 || this.height > 2048
          || !Number.isSafeInteger(this.budget) || this.budget < 1
          || !Number.isInteger(this.fixedCacheLimit)||this.fixedCacheLimit<0||this.fixedCacheLimit>1048576
          || !Number.isInteger(this.quadBudget) || this.quadBudget < 1 || this.quadBudget > 65536
          || !Number.isFinite(this.sliceMs) || this.sliceMs < 0 || this.sliceMs > 16 || typeof this.now !== 'function')
        invalid('invalid target size or execution budget');
      const e = this.exports();
      for (const name of ['guest_alloc','guest_free','guest_map_alloc','guest_map_free','guest_to_wasm',
        'd3d_shader_ir_compile','d3d_shader_ir_free','d3d_shader_vm_compile','d3d_shader_vm_free',
        'd3d_fixed_compile','d3d_fixed_compile_vertex','d3d_fixed_compile_pixel','d3d_fixed_free',
        'd3d_fixed_cache_create','d3d_fixed_cache_free','d3d_fixed_compile_cached','d3d_fixed_light_cached',
        'd3d_software_bind_scissor',
        'd3d_render_coalesce_heap','d3d_software_samples','d3d_software_allocation_bound','d3d_software_retained_bound','d3d_software_bind_texture_mips',
        'd3d_software_bind_depth_format','d3d_software_quantize_depth','d3d_software_bind_stencil','d3d_software_clear_stencil','d3d_software_bind_fill','d3d_software_bind_points',
        'd3d_software_create','d3d_software_step','d3d_software_free','d3d_software_cancel','d3d_software_clear','d3d_software_bind_texture','d3d_software_bind_projection','d3d_software_bind_bump','d3d_software_bind_blend','d3d_software_bind_alpha'])
        if (typeof e[name] !== 'function') invalid(`missing native export ${name}`);
      try {
        this.target = this.alloc(this.pitch * this.height, true);
        this.depth = this.alloc(this.pitch * this.height, true);
        this.clear([0,0,0,1], 3);
        if(this.fixedCacheLimit){
          if(this.bytes+32+this.fixedCacheLimit>this.budget)invalid('fixed cache reservation exceeds allocation budget');
          this.fixedCache=e.d3d_fixed_cache_create(this.fixedCacheLimit)>>>0;
          if(!this.fixedCache)invalid('native fixed cache allocation failed');
          // Reserve the complete native cache capacity, not only occupied
          // nodes: native admission/eviction cannot overspend this device.
          this.bytes+=this.fixedCacheLimit+32;
        }
      } catch (error) { this.free(this.target); this.free(this.depth); throw error; }
    }
    exports() { return this.options.getExports(); }
    colorResource(resource){
      if(!resource||!Number.isInteger(resource.id)||resource.id<=0||!Number.isInteger(resource.width)||!Number.isInteger(resource.height)||
        resource.width<1||resource.height<1||resource.width>2048||resource.height>2048||![21,22].includes(resource.format))invalid('invalid color resource');
      const old=this.colorSurfaces.get(resource.id);
      if(old&&(old.width!==resource.width||old.height!==resource.height||old.format!==resource.format))invalid('color identity changed');
      return old;
    }
    createColor(resource,pixels=null,pitch=resource.width*4){
      this.idle();if(this.colorResource(resource))invalid('duplicate color resource');
      if(pixels!==null)this.colorPixels(resource,pixels,pitch);
      const block=this.alloc(resource.width*resource.height*4,true);
      Object.assign(block,{id:resource.id,width:resource.width,height:resource.height,format:resource.format,pitch:resource.width*4});
      const bytes=new Uint8Array(this.memory(),block.wa,block.bytes);bytes.fill(0);
      if(resource.format===22)for(let i=3;i<bytes.length;i+=4)bytes[i]=255;
      this.colorSurfaces.set(resource.id,block);
      if(pixels!==null)this.updateColor(resource,pixels,pitch);return 1;
    }
    colorPixels(resource,pixels,pitch){
      if(!(pixels instanceof Uint8Array)||!Number.isInteger(pitch)||pitch<resource.width*4||pixels.length!==pitch*resource.height)invalid('invalid color upload');
    }
    updateColor(resource,pixels,pitch,rect){
      this.idle();const target=this.colorSurface(resource);
      resource=resource??{width:this.width,height:this.height,format:22};
      const r=rect??{x:0,y:0,width:resource.width,height:resource.height};
      if(![r.x,r.y,r.width,r.height].every(Number.isInteger)||r.x<0||r.y<0||r.width<=0||r.height<=0||
        r.width>resource.width-r.x||r.height>resource.height-r.y)invalid('invalid color upload rectangle');
      pitch=pitch??r.width*4;this.colorPixels({...resource,width:r.width,height:r.height},pixels,pitch);
      const bytes=new Uint8Array(this.memory(),target.wa,target.bytes);
      for(let y=0;y<r.height;y++)bytes.set(pixels.subarray(y*pitch,y*pitch+r.width*4),(y+r.y)*target.pitch+r.x*4);
      if(resource.format===22)for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)
        bytes[(y+r.y)*target.pitch+(x+r.x)*4+3]=255;return 1;
    }
    colorSurface(resource){if(resource==null)return {...this.target,width:this.width,height:this.height,pitch:this.pitch,format:21};
      const target=this.colorResource(resource);if(!target)invalid('unknown color attachment');return target;}
    readColor(resource){this.idle();const target=this.colorSurface(resource),pixels=new Uint8Array(this.memory(),target.wa,target.pitch*target.height).slice();
      if(target.format===22)for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
      return {pixels,width:target.width,height:target.height,pitch:target.pitch,format:target.format};}
    releaseColor(id){this.idle();const target=this.colorSurfaces.get(id);this.free(target);this.colorSurfaces.delete(id);return 1;}
    depthSurface(metadata,targetWidth=this.width,targetHeight=this.height){
      if(metadata===undefined)return {...this.depth,format:0,pitch:this.pitch};
      if(metadata===null)return null;
      const {id,width,height,format}=metadata;
      if(!Number.isInteger(id)||id<1||!Number.isInteger(width)||!Number.isInteger(height)||
        width<targetWidth||height<targetHeight||width>2048||height>2048||![70,80,75,77].includes(format))invalid('invalid depth attachment');
      let surface=this.depthSurfaces.get(id);
      if(surface){if(surface.width!==width||surface.height!==height||surface.format!==format)invalid('depth identity metadata changed');return surface;}
      surface=this.alloc(width*height*(format===75?5:4),true);Object.assign(surface,{width,height,format,pitch:width*4,
        stencil:format===75?surface.wa+width*height*4:0});
      if(this.exports().d3d_software_clear(0,width,height,width*4,0,surface.wa,width*4,1,2)!==0){this.free(surface);invalid('depth initialization failed');}
      if(surface.stencil&&this.exports().d3d_software_clear_stencil(surface.stencil,width,height,width,0)!==0){this.free(surface);invalid('stencil initialization failed');}
      this.depthSurfaces.set(id,surface);return surface;
    }
    reset(payload){
      this.idle();
      const replacement=new Device({...this.options,width:payload.width,height:payload.height,maxBytes:this.budget-this.bytes});
      try{replacement.depthSurface(payload.depthAttachment);}
      catch(error){replacement.destroy();throw error;}
      // Publish only after all replacement storage has been allocated. Native
      // guest state commits after this ordered command completes.
      this.bytes-=this.queries.size*32;this.queries.clear();
      this.freeFixedCache();
      for(const id of this.colorSurfaces.keys())this.releaseColor(id);
      for(const surface of this.depthSurfaces.values())this.free(surface);
      this.free(this.target);this.free(this.depth);
      this.width=replacement.width;this.height=replacement.height;this.pitch=replacement.pitch;
      this.target=replacement.target;this.depth=replacement.depth;this.depthSurfaces=replacement.depthSurfaces;
      this.fixedCache=replacement.fixedCache;this.fixedCacheLimit=replacement.fixedCacheLimit;replacement.fixedCache=0;
      this.bytes=replacement.bytes;replacement.bytes=0;
      return 1;
    }
    memory() { return this.options.getMemory(); }
    freeFixedCache(){if(this.fixedCache){this.exports().d3d_fixed_cache_free(this.fixedCache);this.fixedCache=0;this.bytes-=this.fixedCacheLimit+32;}}
    idle() { if (this.destroyed) invalid('device destroyed'); if (this.active) invalid('draw still in flight'); }
    alloc(bytes, mapped = false) {
      if (!Number.isSafeInteger(bytes) || bytes < 1 || this.bytes + bytes > this.budget) invalid('allocation budget exceeded');
      const e = this.exports(), guest = (mapped ? e.guest_map_alloc(bytes) : e.guest_alloc(bytes)) >>> 0;
      if (!guest) invalid('native allocation failed');
      const wa = e.guest_to_wasm(guest) >>> 0;
      if (wa < 256 || wa + bytes > this.memory().byteLength
          || (e.guest_to_wasm(guest + bytes - 1) >>> 0) !== wa + bytes - 1) {
        if (mapped) e.guest_map_free(guest); else e.guest_free(guest);
        invalid('native allocation is not contiguous');
      }
      this.bytes += bytes;
      return { guest, wa, bytes, mapped, live: true };
    }
    free(block) {
      if (!block || !block.live) return;
      if (block.mapped) {
        if (this.exports().guest_map_free(block.guest) !== 1) invalid('native mapped allocation release failed');
      } else this.exports().guest_free(block.guest);
      // Keep the owner record intact when native release rejects it. A later
      // destroy can retry; shutdown must never report unreleased storage as 0.
      block.live = false;
      this.bytes -= block.bytes;
    }
    copy(data, owned) {
      const block = this.alloc(data.byteLength || 4); owned.push(block);
      new Uint8Array(this.memory(),block.wa,data.byteLength).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
      return block.wa;
    }
    program(shader, stage, draw) {
      const e = this.exports();
      let ir = 0, projection;
      try {
        if (shader && shader.irVersion === 1 && shader.nativeBytes instanceof Uint8Array) {
          const ptr = this.copy(shader.nativeBytes,draw.owned);
          projection = IR.read(this.memory(),ptr);
          ir = ptr;
        } else if (shader instanceof Uint32Array) {
          const ptr = this.copy(shader,draw.owned);
          ir = e.d3d_shader_ir_compile(ptr,shader.length) >>> 0;
          if (!ir) invalid(`native shader validation failed (${e.d3d_shader_ir_error()})`);
          projection = IR.read(this.memory(),ir);
        } else invalid('shader requires native IR or guest bytecode');
        if (projection.stage !== stage) invalid('shader stage mismatch');
        const program = e.d3d_shader_vm_compile(ir) >>> 0;
        if (!program) invalid('shader exceeds native VM implementation');
        draw.programs.push(program);
        return { pointer: program, ir: projection };
      } finally {
        if (ir && shader instanceof Uint32Array) e.d3d_shader_ir_free(ir);
      }
    }
    fixedPrograms(snapshot, viewport, draw, fixedVS=true, fixedPS=true, uvRequired=0) {
      // Only unbound stages enter this state compiler. A rejected guest
      // shader never falls back here. Matrix/shader arithmetic stays in WAT.
      const original=snapshot.fixedFunction;let f=original&&snapshot.fogState?{...original,fog:snapshot.fogState.enabled,
        fogColor:snapshot.fogState.color,fogTableMode:snapshot.fogState.tableMode}:original;
      const stage=f&&f.stages&&f.stages[0];
      if(!f||!stage)invalid('missing fixed-function state');
      const unsupported=['specular'].filter(flag=>f[flag]);
      if(f.fog&&f.fogTableMode)f={...f,fog:false}; // pixel fog takes precedence over vertex generation
      if(unsupported.length)invalid(`fixed-function features are not implemented: ${unsupported.join(', ')}`);
      const attributes=fixedVS?snapshot.attributes||[]:[];
      const positions=attributes.filter(a=>(a.usage===0||a.usage===9)&&a.usageIndex===0);
      if(fixedVS&&positions.length!==1)invalid('fixed function requires exactly one position');
      const transformed=fixedVS&&positions[0].usage===9;
      if(fixedVS&&(![2,3].includes(positions[0].type)||(transformed&&positions[0].type!==3)))invalid('invalid fixed position format');
      const diffuse=attributes.filter(a=>a.usage===10&&a.usageIndex===0);
      const uv=attributes.filter(a=>a.usage===5&&a.usageIndex===stage.texCoordIndex);
      const psize=attributes.filter(a=>a.usage===4&&a.usageIndex===0);
      if(diffuse.length>1||uv.length>1||psize.length>1)invalid('duplicate fixed vertex semantic');
      if(psize.length&&psize[0].type!==0)invalid('PSIZE requires FLOAT1');
      const selected=[positions[0],diffuse[0],uv[0],psize[0]],registers=selected.map(a=>a?a.register:null),used=new Set();
      for(const register of registers)if(register!==null){
        if(!Number.isInteger(register)||register<0||register>15||used.has(register))invalid('invalid fixed vertex registers');
        used.add(register);
      }
      for(let i=0;i<3;i++)if(registers[i]===null){registers[i]=Array.from({length:16},(_,n)=>n).find(n=>!used.has(n));used.add(registers[i]);}
      const integer=(value,label)=>{
        if(!Number.isInteger(value)||value<0||value>0xffffffff)invalid(`invalid fixed ${label}`);
        return value;
      };
      const point=fixedVS&&snapshot.state?.fillMode===1,pointState=snapshot.state||{};
      const block=this.alloc(point?320:288);draw.owned.push(block);
      const words=new Uint32Array(this.memory(),block.wa,point?80:72),floats=new Float32Array(this.memory(),block.wa,point?80:72);
      const pixel=(value,label)=>fixedPS?integer(value,label):0;
      words.fill(0);
      words.set([0x44465831,point?(psize.length?3:2):1,(transformed?17:0)|(diffuse.length?2:0)|(uv.length?4:0)|(snapshot.textures?.[0]?8:0)|(point?32:0)|(point&&pointState.pointScale?64:0)|(point&&psize.length?128:0),...registers.slice(0,3),
        pixel(stage.colorOp,'COLOROP'),pixel(stage.colorArg1,'COLORARG1'),pixel(stage.colorArg2,'COLORARG2'),
        pixel(stage.alphaOp,'ALPHAOP'),pixel(stage.alphaArg1,'ALPHAARG1'),pixel(stage.alphaArg2,'ALPHAARG2'),
        pixel(f.textureFactor,'texture factor'),pixel(stage.constant,'stage constant'),
        pixel(f.stages[1]?f.stages[1].colorOp:1,'stage1 COLOROP'),fixedVS?integer(stage.transformFlags,'texture transform'):0,
        fixedVS?integer(stage.texCoordIndex,'coordinate index'):0,viewport.x,viewport.y,viewport.width,viewport.height]);
      floats[21]=viewport.minZ;floats[22]=viewport.maxZ;
      if(point){
        const values=['pointSize','pointScaleA','pointScaleB','pointScaleC'].map((key,i)=>pointState[key]===undefined?(i<2?1:0):pointState[key]);
        if(values.some(v=>!Number.isFinite(v)||v<0))invalid('invalid point size/attenuation');
        floats.set(values,72);
        if(psize.length)words[76]=registers[3];
      }
      if(fixedVS&&!transformed)for(const [name,offset]of[['world',24],['view',40],['projection',56]]){
        const values=f[name];
        if(!(values instanceof Float32Array)||values.length!==16)invalid(`invalid fixed ${name} matrix`);
        floats.set(values,offset);
      }
      if(f.stages.length>6)invalid('fixed cascade supports at most six stages');
      const table=this.alloc(6*160);draw.owned.push(table);
      const stageWords=new Uint32Array(this.memory(),table.wa,240);stageWords.fill(0);
      const normals=attributes.filter(a=>a.usage===3&&a.usageIndex===0);
      const speculars=attributes.filter(a=>a.usage===10&&a.usageIndex===1);
      if(f.fog&&speculars.length>1)invalid('duplicate specular fog input');
      let terminated=false;
      for(let i=0;i<6;i++){
        const s=f.stages[i]||{colorOp:1},active=!terminated&&s.colorOp!==1&&!(s.colorArg1===2&&!snapshot.textures?.[i]);
        if(!active)terminated=true;
        if(active&&fixedPS&&s.resultArg!==undefined&&![1,5].includes(s.resultArg))invalid('invalid fixed RESULTARG');
        const needed=(active&&fixedPS)||(fixedVS&&(uvRequired&(1<<i))),flags=s.transformFlags??0;
        if(needed&&flags&&(!fixedVS||![2,3,4,259,260].includes(flags)))invalid('unsupported fixed texture transform flags');
        if(needed&&(flags&256)&&(snapshot.textures?.[i]?.faces||(fixedPS&&([22,23].includes(s.colorOp)||[22,23].includes(f.stages[i-1]?.colorOp)))))
          invalid('projected cube/bump coordinates are not implemented');
        if(needed&&snapshot.textures?.[i]?.faces&&flags&&(flags&255)<3)invalid('cube transform needs three coordinates');
        if(active&&fixedPS&&[22,23].includes(s.colorOp)){
          const texture=snapshot.textures?.[i],coefficients=snapshot.bumpStates?.[i];
          if(!texture||texture.format!==62||texture.faces)invalid('fixed bump requires signed 2D format62');
          if(!(coefficients instanceof Float32Array)||coefficients.length!==6||!coefficients.every(Number.isFinite))invalid('invalid fixed bump coefficients');
        }
        if(active&&fixedPS&&i&&[22,23].includes(f.stages[i-1]?.colorOp)&&snapshot.textures?.[i]?.faces)
          invalid('cube fixed bump coordinates are not implemented');
        const index=s.texCoordIndex??i,generation=index>>>16,input=attributes.filter(a=>a.usage===5&&a.usageIndex===(index&65535));
        if(needed&&(generation>3||generation&&(!fixedVS||transformed)))invalid('unsupported generated texture coordinates');
        if(needed&&(generation===1||generation===3)&&(normals.length!==1||![2,3].includes(normals[0].type)))invalid('camera normal/reflection requires one FLOAT3/4 NORMAL');
        if(input.length>1)invalid('duplicate fixed texture coordinate');
        const reg=input.length?integer(input[0].register,'UV register'):16;
        if((active&&fixedPS)||(fixedVS&&(uvRequired&(1<<i)))){integer(index,'coordinate index');integer(s.transformFlags??0,'texture transform');}
        stageWords.set([integer(s.colorOp,'COLOROP'),s.colorArg1??2,s.colorArg2??1,s.alphaOp??1,s.alphaArg1??2,s.alphaArg2??1,
          s.constant??0xffffffff,snapshot.textures?.[i]?1:0,reg,flags,index,s.resultArg??1,s.colorArg0??1,s.alphaArg0??1,input.length?Math.min(input[0].type+1,4):0,0],i*40);
        stageWords[i*40+32]=normals.length===1?integer(normals[0].register,'NORMAL register'):16;
        stageWords[i*40+33]=(f.normalizeNormals?1:0)|((f.localViewer===false||f.localViewer===0)?0:2);
        if(needed&&flags&&fixedVS&&!transformed){
          if(!(s.transform instanceof Float32Array)||s.transform.length!==16||!s.transform.every(Number.isFinite))invalid('invalid fixed texture matrix');
          new Float32Array(this.memory(),table.wa+i*160+64,16).set(s.transform);
        }
        if(active&&fixedPS)for(const key of ['colorArg1','colorArg2','alphaOp','alphaArg1','alphaArg2','constant',
          ...([25,26].includes(s.colorOp)?['colorArg0']:[]),...([25,26].includes(s.alphaOp)?['alphaArg0']:[])])if(s[key]!==undefined)integer(s[key],key);
      }
      if(f.fog){stageWords[34]=1|(f.rangeFog?2:0);stageWords[35]=integer(f.fogVertexMode??0,'vertex fog mode');
        new Float32Array(this.memory(),table.wa+144,3).set([f.fogStart??0,f.fogEnd??1,f.fogDensity??1]);
        stageWords[39]=speculars.length?integer(speculars[0].register,'specular register'):16;
        integer(f.fogColor??0,'fog color');}
      const e=this.exports(),args=[block.wa,table.wa,6,(fixedVS?1:0)|(fixedPS?2:0),uvRequired];
      const bundle=(this.fixedCache?e.d3d_fixed_compile_cached(this.fixedCache,...args):e.d3d_fixed_compile_cascade5(...args))>>>0;
      if(!bundle)invalid('native fixed-state validation or lowering rejected');
      draw.bundles.push(bundle);
      if(fixedVS&&f.lighting&&!transformed){
        if(normals.length!==1||![2,3].includes(normals[0].type))invalid('lighting requires one FLOAT3/4 NORMAL');
        if(speculars.length>1)invalid('duplicate lighting COLOR2');
        if(!f.material||!Array.isArray(f.lights)||f.lights.length>8)invalid('invalid material or directional light count');
        const lighting=this.alloc(128+64*f.lights.length);draw.owned.push(lighting);
        const lw=new Uint32Array(this.memory(),lighting.wa,32+16*f.lights.length);lw.fill(0);
        const lf=new Float32Array(this.memory(),lighting.wa,lw.length);
        const source=(key,def)=>{const n=f[key]??def;if(!Number.isInteger(n)||n<0||n>2)invalid('invalid material source');return n;};
        const color=(value,label)=>{if(!(value instanceof Float32Array)||value.length!==4||!value.every(Number.isFinite))invalid('invalid '+label);return value;};
        lw.set([0x444c5431,1,f.lights.length,integer(normals[0].register,'NORMAL register'),
          diffuse.length?diffuse[0].register:16,speculars.length?speculars[0].register:16,f.normalizeNormals?1:0,
          f.colorVertex===false||f.colorVertex===0?0:1,source('diffuseMaterialSource',1),source('ambientMaterialSource',0),source('emissiveMaterialSource',0)]);
        lw[12]=integer(f.ambientColor??0,'ambient color');
        for(const [i,key]of ['diffuse','ambient','emissive'].entries())lf.set(color(f.material[key],'material '+key),16+i*4);
        f.lights.forEach((light,i)=>{
          if(light.type!==3)invalid('point and spot lighting are not implemented');
          if(!(light.direction instanceof Float32Array)||light.direction.length!==3||!light.direction.every(Number.isFinite))invalid('invalid light direction');
          const base=32+i*16;lw[base]=3;lf.set(color(light.diffuse,'light diffuse'),base+1);
          lf.set(color(light.ambient,'light ambient'),base+5);lf.set(light.direction,base+9);
        });
        if(!(this.fixedCache?e.d3d_fixed_light_cached(this.fixedCache,bundle,block.wa,lighting.wa):e.d3d_fixed_bind_lighting(bundle,block.wa,lighting.wa)))invalid('native directional lighting validation or instruction budget exceeded');
      }
      const result=new Uint32Array(this.memory(),bundle,8);
      draw.fixedSampled=!!result[5];
      if(fixedPS&&!fixedVS)for(let i=0;i<6;i++)if((result[5]&(1<<i))&&(f.stages[i]?.texCoordIndex??i)!==i)invalid('programmable VS requires default texture coordinate index');
      return [fixedVS?{pointer:result[3],ir:IR.read(this.memory(),result[1])}:null,
        fixedPS?{pointer:result[4],ir:IR.read(this.memory(),result[2])}:null];
    }
    release(draw) {
      if (!draw || draw.released) return;
      draw.released = true;
      for(const context of draw.contexts||[draw.context])if(context)this.exports().d3d_software_free(context);
      if(draw.nativeBytes){this.bytes-=draw.nativeBytes;draw.nativeBytes=0;}
      for (const program of draw.programs) this.exports().d3d_shader_vm_free(program);
      for (const bundle of draw.bundles) this.exports().d3d_fixed_free(bundle);
      for (const block of draw.owned) this.free(block);
      if (this.active === draw) this.active = null;
    }
    prepare(snapshot) {
      this.idle();
      if(this.exports().d3d_render_coalesce_heap()<0)invalid('invalid native free list');
      const large=snapshot.primitiveCount>256 || snapshot.vertices?.byteLength/snapshot.stride>256;
      let batches;
      try{batches=large?Geometry.split(snapshot,this.budget-this.bytes).batches:[snapshot];}
      catch(error){invalid(error.message);}
      const draw={owned:[],programs:[],bundles:[],contexts:[],context:0,nativeBytes:0,released:false};
      try{
        for(const batch of batches)this.prepareBatch(large?{...snapshot,...batch}:batch,draw);
        draw.batchIndex=0;draw.context=draw.contexts[0];
        this.active=draw;return draw;
      }catch(error){this.release(draw);throw error;}
    }
    prepareBatch(snapshot,draw) {
      const fixedVS=!snapshot.vertexShader,fixedPS=!snapshot.pixelShader,fixed=fixedVS||fixedPS;
      if(!fixed&&snapshot.fixedFunction)invalid('fixed state cannot replace bound guest shaders');
      const fog=snapshot.fogState||{enabled:snapshot.fixedFunction?.fog||false,color:snapshot.fixedFunction?.fogColor??0,
        tableMode:snapshot.fixedFunction?.fogTableMode??0,start:snapshot.fixedFunction?.fogStart??0,
        end:snapshot.fixedFunction?.fogEnd??1,density:snapshot.fixedFunction?.fogDensity??1,depthMode:0};
      if(![false,true,0,1].includes(fog.enabled)||!Number.isInteger(fog.color)||fog.color<0||fog.color>0xffffffff
        ||!Number.isInteger(fog.tableMode)||fog.tableMode<0||fog.tableMode>3)invalid('invalid raster fog state');
      if(fog.enabled&&fog.tableMode&&(fog.depthMode??0)!==0)invalid('WFOG is not advertised; production table fog requires device Z');
      if (![4,5,6].includes(snapshot.primitive) || !Number.isInteger(snapshot.primitiveCount)
          || snapshot.primitiveCount < 1 || snapshot.primitiveCount > 256)
        invalid(`only bounded triangle lists, strips and fans are implemented (primitive=${snapshot.primitive}, count=${snapshot.primitiveCount}, limit=256)`);
      const state = snapshot.state || {};
      const fillMode=state.fillMode===undefined?3:state.fillMode,lastPixel=state.lastPixel===undefined?true:state.lastPixel;
      if(![1,2,3].includes(fillMode)||![false,true,0,1].includes(lastPixel))invalid('invalid fill mode/last pixel');
      if(fillMode===1&&state.pointScale!==undefined&&![false,true,0,1].includes(state.pointScale))invalid('invalid point scaling enable');
      if(fillMode===1&&state.pointScale&&!fixedVS)invalid('programmable point attenuation semantics require native-reference validation');
      if(fillMode===1&&state.pointSprite!==undefined&&![false,true,0,1].includes(state.pointSprite))invalid('invalid point sprite enable');
      if(fillMode===2&&state.antialiasedLine)invalid('antialiased wireframe is not implemented');
      // Alpha testing is an output operation for programmed and fixed stages.
      // Older neutral fixed snapshots carry these fields in fixedFunction.
      const alphaValue=(name,fallback)=>state[name]!==undefined?state[name]:
        fixed&&snapshot.fixedFunction&&snapshot.fixedFunction[name]!==undefined?
          snapshot.fixedFunction[name]:fallback;
      const alphaEnabled=alphaValue('alphaTest',false);
      if(![false,true,0,1].includes(alphaEnabled))invalid('invalid alpha-test enable flag');
      let alpha=null;
      if(alphaEnabled){
        const func=alphaValue('alphaFunc',8),reference=alphaValue('alphaRef',0);
        if(!Number.isInteger(func)||func<1||func>8)invalid('invalid alpha comparison');
        if(!Number.isInteger(reference)||reference<0||reference>0xffffffff)invalid('invalid alpha reference');
        alpha=[1,1,func,reference];
      }
      for(const key of ['blend','separateAlpha'])if(state[key]!==undefined&&![false,true,0,1].includes(state[key]))
        invalid('invalid blending enable flag');
      const writeMask=state.colorWriteMask===undefined?15:state.colorWriteMask;
      if(!Number.isInteger(writeMask)||writeMask<0||writeMask>15)invalid('invalid color write mask');
      let blend=null;
      if(state.blend){
        const value=(key,fallback)=>state[key]===undefined?fallback:state[key];
        const factor=value('blendFactor',0xffffffff);
        blend=[1,1|(state.separateAlpha?2:0),value('srcblend',2),value('dstblend',1),value('blendop',1),
          value('srcblendalpha',2),value('dstblendalpha',1),value('blendopalpha',1),factor];
        for(const i of [2,3,5,6])if(!Number.isInteger(blend[i])||blend[i]<1||blend[i]>15||
          ((i===3||i===6)&&[12,13].includes(blend[i])))invalid('unsupported blending factor');
        for(const i of [4,7])if(!Number.isInteger(blend[i])||blend[i]<1||blend[i]>5)invalid('unsupported blending operation');
        if(!Number.isInteger(factor)||factor<0||factor>0xffffffff)invalid('invalid blending constant');
      }
      if (!(snapshot.vertices instanceof Uint8Array) || !Number.isInteger(snapshot.stride)
          || snapshot.stride < 1 || snapshot.stride > 255 || snapshot.vertices.length % snapshot.stride)
        invalid('invalid vertex bytes');
      const n = snapshot.vertices.length / snapshot.stride, count = snapshot.primitiveCount * 3;
      const sourceCount=snapshot.primitive===4?count:snapshot.primitiveCount+2;
      if (n < 3 || n > 256 || count > 768) invalid('vertex/index implementation limit');
      if (snapshot.indices && (!(snapshot.indices instanceof Uint16Array) || snapshot.indices.length < sourceCount)) invalid('invalid INDEX16 data');
      if (!snapshot.indices && n < sourceCount) invalid('vertex range too short');
      // The frontend already applies StartVertex/BaseVertexIndex/min-index
      // offsets. Expand only topology here, in original primitive order.
      // Keep degenerate triangles: they still advance strip winding parity.
      const sourceIndex=i=>snapshot.indices?snapshot.indices[i]:i;
      for(let i=0;i<sourceCount;i++)if(sourceIndex(i)>=n)invalid('index outside vertex snapshot');
      let nativeIndices=snapshot.indices?snapshot.indices.subarray(0,sourceCount):null;
      if(snapshot.primitive!==4){
        nativeIndices=new Uint16Array(count);
        for(let i=0;i<snapshot.primitiveCount;i++){
          const a=snapshot.primitive===6?0:i+(i&1);
          const b=snapshot.primitive===6?i+1:i+1-(i&1);
          nativeIndices.set([sourceIndex(a),sourceIndex(b),sourceIndex(i+2)],i*3);
        }
      }
      try {
        const colorTarget=this.colorSurface(snapshot.colorAttachment),targetWidth=colorTarget.width,targetHeight=colorTarget.height;
        const vp=snapshot.viewport||{x:0,y:0,width:targetWidth,height:targetHeight,minZ:0,maxZ:1};
        const scissor=snapshot.scissor;
        if(scissor&&(![true,false,0,1].includes(scissor.enabled)||(scissor.enabled&&(
          [scissor.left,scissor.top,scissor.right,scissor.bottom].some(v=>!Number.isInteger(v))||
          scissor.left<0||scissor.top<0||scissor.right<scissor.left||scissor.bottom<scissor.top||
          scissor.right>targetWidth||scissor.bottom>targetHeight))))invalid('invalid scissor rectangle');
        for(const value of [vp.x,vp.y,vp.width,vp.height])if(!Number.isInteger(value)||value<0)invalid('invalid viewport');
        if(vp.width<1||vp.height<1||vp.x+vp.width>targetWidth||vp.y+vp.height>targetHeight
          ||!Number.isFinite(vp.minZ)||!Number.isFinite(vp.maxZ)||vp.minZ<0||vp.maxZ>1||vp.minZ>vp.maxZ)invalid('invalid viewport');
        if(!draw.shaders){
          // Validate each bound guest stage first; never recover by lowering it.
          const shaders=[fixedVS?null:this.program(snapshot.vertexShader,'vertex',draw),
            fixedPS?null:this.program(snapshot.pixelShader,'pixel',draw)];
          let uvRequired=0;
          if(fixedVS&&!fixedPS){
            const b=shaders[1].ir.nativeBytes,v=new DataView(b.buffer,b.byteOffset,b.byteLength);
            const projected=snapshot.fixedFunction.stages.map(s=>!!((s.transformFlags||0)&256));
            if(projected.some(Boolean)&&![0xffff0101,0xffff0102,0xffff0103].includes(shaders[1].ir.version))
              invalid('projected programmed pixels require PS1.1-1.3');
            for(let i=0;i<v.getUint32(16,true);i++){
              const at=32+i*128;
              const opcode=v.getUint32(at,true),destination=v.getUint32(at+20,true);
              if(projected[destination]&&(opcode===64||(opcode>=67&&opcode<=76)||(opcode>=82&&opcode<=87)))
                invalid('projected TEXCOORD/dependent texture destination is not implemented');
              for(let j=0;j<v.getUint32(at+8,true);j++)if(v.getUint32(at+16+j*16,true)===3){
                const index=v.getUint32(at+20+j*16,true);if(index>5)invalid('fixed vertex lowering supports six texture outputs');
                uvRequired|=1<<index;
              }
            }
          }
          if(fixed){const lowered=this.fixedPrograms(snapshot,vp,draw,fixedVS,fixedPS,uvRequired);
            if(fixedVS)shaders[0]=lowered[0];if(fixedPS)shaders[1]=lowered[1];}
          draw.shaders=shaders;
        }
        const [vs,ps]=draw.shaders;
        if(fog.enabled){
          if(!fixedPS&&![0xffff0101,0xffff0102,0xffff0103].includes(ps.ir.version))invalid('programmed pixel fog requires PS1.1-1.3');
          if(!fixedVS&&!fog.tableMode){const bytes=vs.ir.nativeBytes,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let writesFog=false;
            for(let i=0;i<view.getUint32(16,true);i++)if(view.getUint32(32+i*128+16,true)===4&&view.getUint32(32+i*128+20,true)===1)writesFog=true;
            if(!writesFog)invalid('programmed vertex fog requires oFog output');}
        }
        const sampled=new Set(),bumped=new Set();
        for(const shader of [vs,ps]) {
          const bytes=shader.ir.nativeBytes,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
          for(let i=0;i<view.getUint32(16,true);i++) {
            const at=32+i*128,opcode=view.getUint32(at,true);
            if(shader===ps&&fog.enabled&&fog.tableMode&&(opcode===84||opcode===87))invalid('table fog with shader-written depth needs conformance');
            if(shader===ps && [66,67,68,69,70,72,74,75,76,82,83].includes(opcode)){
              const stage=view.getUint32(at+20,true);
              if(stage>5||!snapshot.textures?.[stage])invalid(`missing pixel sampler${stage}`);
              sampled.add(stage);if(opcode===67||opcode===68)bumped.add(stage);
            }
            for(let j=0;j<view.getUint32(at+8,true);j++) {
              const arg=at+16+j*16,bank=view.getUint32(arg,true),index=view.getUint32(arg+4,true);
              if(shader===ps && ((bank===1&&index!==0)||(bank===3&&index>5)))invalid('only pixel diffuse0 and texture0..5 linkage is implemented');
              if(shader===vs && ((bank===4&&index>2)||(bank===5&&index!==0)||(bank===6&&index>5)))invalid('only position/fog/point-size/diffuse0/texture0..5 outputs are implemented');
            }
          }
        }
        const native = new DataView(vs.ir.nativeBytes.buffer,vs.ir.nativeBytes.byteOffset,vs.ir.nativeBytes.byteLength);
        const inputs = new Set();
        for(let i=0;i<native.getUint32(16,true);i++) {
          const at=32+i*128;
          for(let j=0;j<native.getUint32(at+8,true);j++) {
            const arg=at+16+j*16;
            if(native.getUint32(arg,true)===1) inputs.add(native.getUint32(arg+4,true));
          }
        }
        const declarations = new Map(vs.ir.instructions.filter(ins=>ins.opcode===31)
          .map(ins=>[ins.args[1]&2047,{usage:ins.args[0]&15,usageIndex:(ins.args[0]>>>16)&15}]));
        const selected = Array(9).fill(null), registers = [0,1,2,3,4,5,6,7,8];
        let uvCount=1;const extraInputs=[];
        for(const register of inputs) {
          if(register>15)invalid('vertex register implementation limit');
          const semantic=declarations.get(register);
          const a=(snapshot.attributes||[]).find(a=>semantic
            ? a.usage===semantic.usage&&a.usageIndex===semantic.usageIndex : a.register===register);
          if(!a)invalid(`missing vertex input v${register}`);
          const slot=(a.usage===0||(fixedVS&&a.usage===9))&&a.usageIndex===0?0:a.usage===10&&a.usageIndex===0?1:a.usage===4&&a.usageIndex===0?8:
            a.usage===5&&Number.isInteger(a.usageIndex)&&a.usageIndex>=0&&a.usageIndex<6?2+a.usageIndex:-1;
          const isNormal=a.usage===3&&a.usageIndex===0,isSpecular=a.usage===10&&a.usageIndex===1;
          if((slot<0&&!isNormal&&!isSpecular) || selected[slot])invalid('only one position/diffuse/PSIZE and six UV linkages are implemented');
          if(slot===8&&a.type!==0)invalid('PSIZE requires FLOAT1');
          if(!Number.isInteger(a.type)||a.type<0||a.type>4||!Number.isInteger(a.offset)||a.offset<0
            ||a.offset+(a.type===4?4:(a.type+1)*4)>snapshot.stride)invalid('invalid vertex attribute');
          if(isNormal||isSpecular){if(extraInputs.some(x=>x.a.usage===a.usage)||!(isNormal?[2,3]:[3,4]).includes(a.type))invalid('invalid NORMAL/specular input');extraInputs.push({a,register});continue;}
          selected[slot]=a;registers[slot]=register;
          if(slot>=2&&slot<8)uvCount=Math.max(uvCount,slot-1);
        }
        // ABI5 appends independent NORMAL/SPECULAR lanes instead of borrowing
        // a UV lane. Preserve ABI1-4 packing for draws without extra semantics.
        const hasPsize=!!selected[8],completeInputs=extraInputs.length>0;
        let slots=2+uvCount;
        if(hasPsize){selected[slots]=selected[8];registers[slots]=registers[8];slots++;}
        for(const input of extraInputs){selected[slots]=input.a;registers[slots]=input.register;slots++;}
        if(slots>11)invalid('native vertex input count exceeds eleven');
        const packedStride=slots*16;
        // Unused inputs still need distinct native slots; do not overwrite a
        // requested v1/v2 with defaults while mapping another semantic there.
        const used=new Set(selected.map((a,i)=>a?registers[i]:-1));
        for(let s=0;s<slots;s++)if(!selected[s]){
          registers[s]=Array.from({length:16},(_,i)=>i).find(i=>!used.has(i));used.add(registers[s]);
        }
        const packed=new Float32Array(n*slots*4), source=new DataView(snapshot.vertices.buffer,snapshot.vertices.byteOffset,snapshot.vertices.byteLength);
        for(let i=0;i<n;i++)for(let s=0;s<slots;s++){
          const a=selected[s],base=i*slots*4+s*4;
          packed.set(s===1?[1,1,1,1]:[0,0,0,1],base);
          if(a)for(let c=0;c<(a.type===4?4:a.type+1);c++)
            packed[base+c]=a.type===4?source.getUint8(i*snapshot.stride+a.offset+c)/255:source.getFloat32(i*snapshot.stride+a.offset+c*4,true);
        }
        const vertices=this.copy(packed,draw.owned);
        const indices=nativeIndices?this.copy(nativeIndices,draw.owned):0;
        const constants=(values,max)=>{
          if(values===undefined)return [0,0];
          if(!(values instanceof Float32Array)||values.length%4||values.length>max*4)invalid('invalid shader constants');
          return [values.length?this.copy(values,draw.owned):0,values.length/4];
        };
        // Fixed constants are generated by the native state compiler's DEF
        // records, not the programmable constant banks currently bound by the guest.
        const [vc,pc]=draw.constants||(draw.constants=[fixedVS?[0,0]:constants(snapshot.vertexConstants,96),
          fixedPS?[0,0]:constants(snapshot.pixelConstants,8)]);
        const desc=this.alloc(128);draw.owned.push(desc);
        const u32=new Uint32Array(this.memory(),desc.wa,32),f32=new Float32Array(this.memory(),desc.wa,32);
        const extended=uvCount>1||hasPsize||completeInputs;
        let extraMap=0;for(let i=3;i<(completeInputs?slots:2+uvCount);i++)extraMap|=registers[i]<<((i-3)*4);
        if(hasPsize&&!completeInputs)extraMap|=registers[2+uvCount]<<20;
        const depth=this.depthSurface(snapshot.depthAttachment,targetWidth,targetHeight);
        u32.set([0x44535031,completeInputs?5:hasPsize?4:uvCount>4?3:extended?2:1,targetWidth,targetHeight,colorTarget.wa,colorTarget.pitch,depth?depth.wa:0,depth?depth.pitch:0,
          vertices,nativeIndices?n:count,packedStride,indices,count,vs.pointer,ps.pointer,...vc,...pc,
          vp.x,vp.y,vp.width,vp.height]);
        f32[23]=vp.minZ;f32[24]=vp.maxZ;
        const pretransformed=fixedVS&&selected[0].usage===9;
        u32.set([(depth&&state.zenable?(1|(state.zwrite?2:0)):0)|(pretransformed?4:0)|(fillMode===1?8:0),state.zfunc===undefined?4:state.zfunc,colorTarget.format===22?writeMask&7:writeMask,
          state.cull===undefined?1:state.cull,registers[0]|registers[1]<<4|registers[2]<<8,completeInputs?slots:extended?uvCount:0,extraMap],25);
        const nativeBytes=this.exports().d3d_software_allocation_bound(nativeIndices?n:count,count)>>>0;
        if(!nativeBytes||this.bytes+nativeBytes>this.budget)invalid('native raster allocation budget exceeded');
        this.bytes+=nativeBytes;draw.nativeBytes+=nativeBytes;
        draw.context=this.exports().d3d_software_create(desc.wa)>>>0;
        if(!draw.context)invalid('native raster validation rejected');
        draw.contexts.push(draw.context);
        // Creation reserves worst-case clipping/workspace capacity. Once native
        // validation and compaction finish, later batches need only retain this
        // context's smaller bound; all contexts are still validated before pixels.
        const retainedBytes=this.exports().d3d_software_retained_bound(draw.context)>>>0;
        if(!retainedBytes||retainedBytes>nativeBytes)invalid('invalid native retained allocation bound');
        this.bytes-=nativeBytes-retainedBytes;draw.nativeBytes-=nativeBytes-retainedBytes;
        if(!this.exports().d3d_software_bind_depth_format(draw.context,depth?depth.format:0))invalid('native depth format rejected');
        if(draw.bindings){
          for(const [name,args]of draw.bindings)
            if(!this.exports()[name](draw.context,...args))invalid('native shared binding rejected');
          return;
        }
        draw.bindings=[];
        const bind=(name,...args)=>{
          if(!this.exports()[name](draw.context,...args))invalid(`native binding rejected: ${name}`);
          draw.bindings.push([name,args]);
        };
        bind('d3d_software_bind_fill',fillMode,lastPixel?1:0);
        bind('d3d_software_bind_scissor',scissor?.enabled?1:0,scissor?.left||0,scissor?.top||0,scissor?.right||0,scissor?.bottom||0);
        if(fillMode===1){
          const values=['pointSize','pointSizeMin','pointSizeMax'].map(key=>state[key]===undefined?1:state[key]);
          if(values.some(v=>!Number.isFinite(v)||v<0||v>2048))invalid('invalid point size bounds');
          const pd=this.alloc(32);draw.owned.push(pd);new Uint32Array(this.memory(),pd.wa,8).fill(0);
          new Uint32Array(this.memory(),pd.wa,2).set([1,state.pointSprite?1:0]);
          // Matches current guest MaxPointSize. A larger native test descriptor
          // proves implementation behavior without advertising unsupported GPU caps.
          new Float32Array(this.memory(),pd.wa+8,4).set([...values,1]);
          bind('d3d_software_bind_points',pd.wa);
        }
        if(state.stencilEnable){
          if(!depth||depth.format!==75)invalid('stencil requires D24S8 attachment');
          if(![false,true,0,1].includes(state.stencilEnable)||
            (state.twoSidedStencil!==undefined&&![false,true,0,1].includes(state.twoSidedStencil)))invalid('invalid stencil enable');
          const value=(key,def)=>state[key]===undefined?def:state[key];
          const reference=value('stencilRef',0),readMask=value('stencilMask',0xffffffff),writeMask=value('stencilWriteMask',0xffffffff);
          if([reference,readMask,writeMask].some(v=>!Number.isInteger(v)||v<0||v>0xffffffff))invalid('invalid stencil masks/reference');
          const ops=['stencilFail','stencilZFail','stencilPass','stencilFunc','ccwStencilFail','ccwStencilZFail','ccwStencilPass','ccwStencilFunc']
            .map((key,i)=>value(key,i%4===3?8:1));
          if(ops.some(v=>!Number.isInteger(v)||v<1||v>8))invalid('invalid stencil operation/comparison');
          const sd=this.alloc(64);draw.owned.push(sd);
          new Uint32Array(this.memory(),sd.wa,16).set([1,1|(state.twoSidedStencil?2:0),depth.stencil,depth.width,reference,readMask,writeMask,...ops,0]);
          bind('d3d_software_bind_stencil',sd.wa);
        }
        if(alpha){
          const ad=this.alloc(16);draw.owned.push(ad);new Uint32Array(this.memory(),ad.wa,4).set(alpha);
          bind('d3d_software_bind_alpha',ad.wa);
        }
        if(blend){
          const bd=this.alloc(36);draw.owned.push(bd);new Uint32Array(this.memory(),bd.wa,9).set(blend);
          bind('d3d_software_bind_blend',bd.wa);
        }
        for(const stage of sampled)this.bindTexture(snapshot.textures[stage],stage,draw,bind,snapshot.colorAttachment?.id);
        if(fog.enabled){
          if(fog.tableMode){const fd=this.alloc(32);draw.owned.push(fd);
            new Uint32Array(this.memory(),fd.wa,8).set([1,fog.tableMode,fog.color,0,0,0,0,0]);
            new Float32Array(this.memory(),fd.wa+16,3).set([fog.start??0,fog.end??1,fog.density??1]);
            bind('d3d_software_bind_table_fog',fd.wa);
          }else bind('d3d_software_bind_fog',1,fog.color);
        }
        for(const stage of sampled){
          const flags=fixedVS?snapshot.fixedFunction.stages[stage]?.transformFlags||0:0;
          bind('d3d_software_bind_projection',stage,flags&256?flags&255:0);
        }
        for(const stage of bumped){
          // Fixed TSS owns coefficients on the source stage; programmable
          // TEXBEM uses destination-stage state. Native binder is destination-keyed.
          const values=snapshot.bumpStates?.[fixedPS?stage-1:stage];
          if(!(values instanceof Float32Array)||values.length!==6||!values.every(Number.isFinite))
            invalid(`invalid bump coefficients for stage ${stage}`);
          const bd=this.alloc(28);draw.owned.push(bd);
          new Uint32Array(this.memory(),bd.wa,1)[0]=1;
          new Float32Array(this.memory(),bd.wa+4,6).set(values);
          bind('d3d_software_bind_bump',stage,bd.wa);
        }
      } catch(error){throw error;}
    }
    bindTexture(texture,stage,draw,bind,feedbackId){
      const cube=texture.faces!==undefined;
      const faces=cube?texture.faces:[texture];
      if(!Array.isArray(faces)||faces.length!==(cube?6:1))invalid('invalid cube face count');
      const chains=faces.map(face=>face?.levels===undefined?[face]:face.levels);
      const levels=chains[0];
      if(!Array.isArray(levels)||levels.length<1||levels.length>12)invalid('invalid mip level count');
      if(chains.some(chain=>!Array.isArray(chain)||chain.length!==levels.length))invalid('inconsistent cube mip counts');
      const s=texture.sampler||{},value=(key,fallback)=>s[key]===undefined?fallback:s[key];
      const uint=(n,label)=>{if(!Number.isInteger(n)||n<0||n>0xffffffff)invalid(`invalid ${label}`);return n;};
      const min=uint(value('min',1),'min filter'),mag=uint(value('mag',1),'mag filter'),mip=uint(value('mip',0),'mip filter');
      if(![1,2].includes(min)||![1,2].includes(mag)||![0,1,2].includes(mip))invalid('unsupported texture filter');
      const bias=value('lodBias',0);if(!Number.isFinite(bias)||!Number.isFinite(Math.fround(bias)))invalid('invalid LOD bias');
      const resourceLevels=chains.some(chain=>chain.some(level=>level?.resource));
      const inputFormat=texture.format===undefined?0:texture.format,format=resourceLevels?21:inputFormat;
      if(![0,62].includes(inputFormat)||resourceLevels&&inputFormat!==0)invalid('unsupported software texture snapshot format');
      const base=uint(texture.baseLOD===undefined?0:texture.baseLOD,'base LOD');
      if(base&&(texture.originalWidth===undefined||texture.originalHeight===undefined))invalid('resident mips require original dimensions');
      const width=uint(texture.originalWidth===undefined?texture.width:texture.originalWidth,'original width');
      const height=uint(texture.originalHeight===undefined?texture.height:texture.originalHeight,'original height');
      if(cube&&(width!==height||value('addressU',1)!==3||value('addressV',1)!==3))
        invalid('native cube sampling currently requires square CLAMP faces');
      const table=this.alloc(faces.length*levels.length*16);draw.owned.push(table);
      for(let face=0;face<faces.length;face++)for(let i=0;i<levels.length;i++){
        const level=chains[face][i];
        if(!level||!Number.isInteger(level.width)||!Number.isInteger(level.height)
          ||level.width<1||level.height<1||level.width>2048||level.height>2048
          ||(!level.resource&&(!(level.pixels instanceof Uint8Array)||level.pixels.length!==level.width*level.height*4)))invalid(`invalid four-byte mip level ${i}`);
        let pixels,pitch=level.width*4;
        if(level.resource){
          if(level.pixels!==undefined)invalid('ambiguous resource/pixel mip');
          if(level.resource.id===feedbackId)invalid('render target sampler feedback');
          const resource=this.colorResource(level.resource);
          if(!resource||resource.width!==level.width||resource.height!==level.height||level.pitch!==undefined&&level.pitch!==resource.pitch)invalid('invalid resource mip layout');
          pixels=resource.wa;pitch=resource.pitch;
        }else if(resourceLevels){
          const bgra=level.pixels.slice();for(let j=0;j<bgra.length;j+=4){bgra[j]=level.pixels[j+2];bgra[j+2]=level.pixels[j];}
          pixels=this.copy(bgra,draw.owned);
        }else pixels=this.copy(level.pixels,draw.owned);
        new Uint32Array(this.memory(),table.wa+(face*levels.length+i)*16,4).set([pixels,level.width,level.height,pitch]);
      }
      const desc=this.alloc(64);draw.owned.push(desc);
      new Uint32Array(this.memory(),desc.wa,16).set([1,levels.length,table.wa,format,
        uint(value('addressU',1),'addressU'),uint(value('addressV',1),'addressV'),uint(value('borderColor',0),'border color'),
        min,mag,mip,0,uint(value('maxMipLevel',0),'max mip level'),base,width,height,cube?1:0]);
      new DataView(this.memory()).setFloat32(desc.wa+40,bias,true);
      bind('d3d_software_bind_texture_mips',stage,desc.wa);
    }
    step(draw){
      const status=this.exports().d3d_software_step(draw.context,this.quadBudget);
      if(status===0&&draw.contexts&&draw.batchIndex+1<draw.contexts.length){
        draw.context=draw.contexts[++draw.batchIndex];return 1;
      }
      return status;
    }
    completeDraw(draw){
      if(draw.samplesPublished)return;
      let samples=0n;
      for(const context of draw.contexts){
        const count=this.exports().d3d_software_samples(context);
        if(typeof count!=='bigint'||count<0n)invalid('native sample count unavailable');
        samples+=count;
      }
      // A split command publishes once, after every batch succeeds. Retained
      // contexts still exist here; cancellation/failure never reaches this path.
      this.completedSamples+=samples;this.lastDrawSamples=samples;
      draw.samplesPublished=true;
    }
    sampleCount(){this.idle();return this.completedSamples;}
    queryId(id){if(!Number.isInteger(id)||id<1||id>0xffffffff)invalid('invalid query identity');return id;}
    queryBegin(id){
      this.idle();this.queryId(id);
      if(!this.queries.has(id)){
        if(this.queries.size>=4096||this.bytes+32>this.budget)invalid('query budget exceeded');
        this.bytes+=32;
      }
      this.queries.set(id,this.completedSamples);return 1;
    }
    queryEnd(id){
      this.idle();this.queryId(id);
      if(!this.queries.has(id))invalid('query has no begin');
      const samples=this.completedSamples-this.queries.get(id);
      // Data-only wire format works in both JSON diagnostics and structured
      // clone. Guest DWORD narrowing belongs to the native API frontend.
      return {samplesLow:Number(samples&0xffffffffn),samplesHigh:Number((samples>>32n)&0xffffffffn)};
    }
    queryRelease(id){this.idle();this.queryId(id);if(this.queries.delete(id))this.bytes-=32;return 1;}
    draw(snapshot) {
      const draw=this.prepare(snapshot);
      try {
        let status=1;
        while(status===1)status=this.step(draw);
        if(status!==0)invalid(`native raster execution failed (${status})`);
        this.completeDraw(draw);
        return 1;
      } finally {this.release(draw);}
    }
    drawAsync(snapshot) {
      const draw=this.prepare(snapshot),schedule=this.options.schedule||(callback=>setTimeout(callback,0));
      const promise=new Promise((resolve,reject)=>{
        draw.reject=reject;
        const step=()=>{
          if(draw.released)return;
          try {
            const started=this.sliceMs?this.now():0;
            let status=1,steps=0;
            do {
              status=this.step(draw);
              steps++;
              // Time is checked after every bounded native step. A callback
              // can overrun the deadline by one step; the hard cap also bounds
              // coarse clocks. Never spin through a microtask continuation.
            } while(status===1&&steps<64&&this.sliceMs>0&&this.now()-started<this.sliceMs);
            if(status===1){schedule(step);return;}
            if(status!==0)invalid(`native raster execution failed (${status})`);
            this.completeDraw(draw);
            this.release(draw);resolve(1);
          }catch(error){this.release(draw);reject(error);}
        };
        try{schedule(step);}catch(error){this.release(draw);reject(error);}
      });
      promise.catch(()=>{});return promise;
    }
    clear(color,flags,depth=1,rects=null,depthAttachment=undefined,stencil=0,colorAttachment=undefined) {
      this.idle();
      const target=this.colorSurface(colorAttachment);
      if(!Array.isArray(color)||color.length!==4||color.some(v=>!Number.isFinite(v)||v<0||v>1)
        ||!Number.isInteger(flags)||flags<0||flags>7)invalid('invalid clear');
      if((flags&4)&&(!Number.isInteger(stencil)||stencil<0||stencil>0xffffffff||depthAttachment?.format!==75))invalid('stencil clear requires D24S8 and uint32 value');
      if((flags&2)&&(!Number.isFinite(depth)||depth<0||depth>1))invalid('invalid clear depth');
      const regions=rects===null?[[0,0,target.width,target.height]]:rects;
      if(!Array.isArray(regions)||regions.length>65536||regions.some(r=>!Array.isArray(r)||r.length!==4||
        r.some(v=>!Number.isInteger(v))||r[0]<0||r[1]<0||r[2]<r[0]||r[3]<r[1]||r[2]>target.width||r[3]>target.height))invalid('invalid clear rectangles');
      const c=color.map(v=>Math.round(v*255));
      const surface=flags&6?this.depthSurface(depthAttachment,target.width,target.height):null;
      if((flags&2)&&!surface)invalid('depth clear without depth attachment');
      const storedDepth=surface?this.exports().d3d_software_quantize_depth(surface.format,depth):depth;
      const packed=((target.format===22?255:c[3])<<24|c[0]<<16|c[1]<<8|c[2])>>>0;
      for(const [left,top,right,bottom]of regions)if(right>left&&bottom>top){
        const offset=top*target.pitch+left*4;
        if(this.exports().d3d_software_clear(target.wa+offset,right-left,bottom-top,target.pitch,packed,
          surface?surface.wa+top*surface.pitch+left*4:0,surface?surface.pitch:0,storedDepth,flags&3)!==0)invalid('native clear failed');
        if((flags&4)&&this.exports().d3d_software_clear_stencil(surface.stencil+top*surface.width+left,
          right-left,bottom-top,surface.width,stencil)!==0)invalid('native stencil clear failed');
      }
      return 1;
    }
    readPixels(){this.idle();return new Uint8Array(this.memory(),this.target.wa,this.pitch*this.height).slice();}
    present(){return {pixels:this.readPixels(),width:this.width,height:this.height,pitch:this.pitch};}
    finish(){this.idle();return 1;}
    cancel(){if(this.active){const draw=this.active;this.exports().d3d_software_cancel(draw.context);this.release(draw);
      if(draw.reject)draw.reject(new Error('D3D9 software draw cancelled'));}return true;}
    destroy(){if(this.destroyed)return;this.cancel();this.bytes-=this.queries.size*32;this.queries.clear();this.freeFixedCache();for(const id of this.colorSurfaces.keys())this.releaseColor(id);for(const surface of this.depthSurfaces.values())this.free(surface);this.depthSurfaces.clear();this.free(this.target);this.free(this.depth);this.destroyed=true;}
    execute(command){
      const op=Stream.OPCODES,p=command.payload;
      try {
      switch(command.opcode){
        case op.DRAW: return this.options.schedule?{value:1,completion:this.drawAsync(p)}:{value:this.draw(p),complete:true};
        case op.CLEAR: return {value:this.clear(p.color,p.flags,p.depth,p.rects,p.depthAttachment,p.stencil,p.colorAttachment),complete:true};
        case op.RESOURCE_CREATE:
          if(p.kind!=='color')invalid('unsupported resource creation');return {value:this.createColor(p.resource,p.pixels,p.pitch),complete:true};
        case op.RESOURCE_UPDATE:
          if(p.kind==='color')return {value:this.updateColor(p.resource,p.pixels,p.pitch,p.rect),complete:true};
          if(p.kind!=='reset')invalid('unsupported resource update');
          return {value:this.reset(p),complete:true};
        case op.PRESENT:return {value:this.present(),complete:true};
        case op.READBACK:return {value:p?.resource?this.readColor(p.resource):this.present(),complete:true};
        case op.FENCE:return {value:this.finish(),complete:true};
        case op.QUERY_BEGIN:return {value:this.queryBegin(p.queryId),complete:true};
        case op.QUERY_END:return {value:this.queryEnd(p.queryId),complete:true};
        case op.RESOURCE_RELEASE:
          if(p.kind==='color-set'){
            this.idle();if(!Array.isArray(p.ids)||p.ids.some(id=>!Number.isInteger(id)||id<=0))invalid('invalid color retirement set');
            for(const id of new Set(p.ids))this.releaseColor(id);
          }
          else if(p.kind==='color')this.releaseColor(p.id);
          else if(p.kind==='depth'){this.idle();this.free(this.depthSurfaces.get(p.id));this.depthSurfaces.delete(p.id);}
          else if(p.kind==='query')this.queryRelease(p.queryId);
          else if(p.kind==='device')this.destroy();
          else invalid('unsupported resource release');return {value:1,complete:true};
        default:invalid('unsupported neutral command');
      }
      } catch(error) {
        // Direct API validation is synchronous; native storage has already been
        // retired by draw's finally block. Return its error to the calling WAT
        // API without poisoning later valid submissions. Deferred faults still
        // reject their completion promise and fault the device stream.
        return {value:{error},complete:true};
      }
    }
  }
  return {Device};
});
