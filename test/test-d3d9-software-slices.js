#!/usr/bin/env node
'use strict';
// Scheduling-contract tests with a deterministic native-step clock. Actual
// pixels/worker lifetime are covered by test-d3d9-software-worker and the bench.
const assert=require('assert');
const {Device}=require('../lib/d3d9-software-backend');
function harness({sliceMs=4,cost=1,finish=Infinity,fail=0}={}){
  const state={calls:0,time:0,releases:0,cancels:0,scheduled:[],events:[]};
  const device=Object.create(Device.prototype);
  Object.assign(device,{sliceMs,quadBudget:256,now:()=>state.time,
    options:{schedule:callback=>state.scheduled.push(callback)},
    exports:()=>({d3d_software_step(context,budget){
      assert.strictEqual(context,1);assert.strictEqual(budget,256);state.calls++;state.time+=cost;
      state.events.push('step');if(state.calls===fail)return -1;return state.calls>=finish?0:1;
    },d3d_software_cancel(){state.cancels++;}}),
    prepare(){assert(!this.active);return this.active={context:1,released:false};},
    release(draw){assert(!draw.released,'single release');draw.released=true;this.active=null;state.releases++;state.events.push('release');},
  });
  return {device,state};
}
(async()=>{
  {
    const {device,state}=harness(),task=device.drawAsync({});
    assert.strictEqual(state.calls,0,'initial work remains scheduled');
    state.scheduled.shift()();assert.strictEqual(state.calls,4,'deadline checked after each native step');
    assert.strictEqual(state.scheduled.length,1,'one macrotask continuation');
    assert.strictEqual(state.releases,0,'yield is not completion');
    // Control messages/cancellation get a turn before the next raster slice.
    device.cancel();await assert.rejects(task,/cancel/);assert.strictEqual(state.cancels,1);
    state.scheduled.shift()();assert.strictEqual(state.calls,4,'cancelled queued callback cannot run native code');
    assert.strictEqual(state.releases,1);
  }
  for(const [sliceMs,cost,expected]of[[0,1,1],[4,7,1],[4,0,64]]){
    const {device,state}=harness({sliceMs,cost}),task=device.drawAsync({});state.scheduled.shift()();
    assert.strictEqual(state.calls,expected,'legacy single-step, long-step overrun or coarse-clock hard cap');
    assert.strictEqual(state.scheduled.length,1);device.cancel();await assert.rejects(task,/cancel/);
    state.scheduled.shift()();assert.strictEqual(state.releases,1);
  }
  {
    const {device,state}=harness({finish:3}),task=device.drawAsync({});
    state.scheduled.shift()();assert.strictEqual(await task,1);assert.strictEqual(state.calls,3);
    assert.deepStrictEqual(state.events,['step','step','step','release']);assert.strictEqual(state.scheduled.length,0);
  }
  {
    const {device,state}=harness({fail:2}),task=device.drawAsync({});state.scheduled.shift()();
    await assert.rejects(task,/execution failed/);assert.strictEqual(state.calls,2);assert.strictEqual(state.releases,1);
    assert.strictEqual(state.scheduled.length,0,'failure never posts more raster work');
  }
  {
    const {device,state}=harness();device.options.schedule=()=>{throw new Error('scheduler unavailable');};
    await assert.rejects(device.drawAsync({}),/scheduler unavailable/);assert.strictEqual(state.releases,1);assert.strictEqual(state.calls,0);
  }
  for(const sliceMs of [-1,17,NaN,Infinity])assert.throws(()=>new Device({width:1,height:1,sliceMs}),/execution budget/);
  console.log('PASS software time slices: deadline/step cap, scheduled fairness, legacy single-step, completion/error/cancel ownership');
})().catch(error=>{console.error(error);process.exitCode=1;});
