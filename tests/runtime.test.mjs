import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloatingRuntime } from '../src/runtime.mjs';
import { observable,bindingFixture,event,user } from './helpers.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const a=bindingFixture('a'),b=bindingFixture('b'); const bindings={a:a.binding,b:b.binding};const calls={send:[],release:[],retain:[],cancel:0};
  const timers=new Set();const snapshots=[];let response={target:null,command:null,ack:[]};
  const connection={state:observable('connected'),generation:observable({id:1})};
  const sessions={list:observable({byId:{a:{displayTitle:'会话A'},b:{displayTitle:'会话B'}}}),retain(id){calls.retain.push(id);return{ready:Promise.resolve(bindings[id]),release(){calls.release.push(id);}};}};
  const conversation={createDrafts:()=>[{id:'image'}],releaseDraftAttachments(){},sendSession:async(...args)=>{calls.send.push(args);return{kind:'success'};}};
  a.binding.session.cancel=async()=>{calls.cancel++;return{ok:true};};
  const api=async body=>{if(body.action==='update'){snapshots.push(body);return{ok:true};}return response;};
  const runtime=new FloatingRuntime({sessions,conversation,connection,api,makeFile:()=> 'file',schedule:fn=>{timers.add(fn);return fn;},unschedule:fn=>timers.delete(fn)});
  const target={id:'binding-a',sessionId:'a',clientId:'one',title:'会话A'};
  return{a,b,calls,runtime,connection,snapshots,timers,target,setResponse:r=>{response=r;}};
}
test('resident reference and stream survive toolbar unmount and main session switching',async()=>{
  const f=fixture();try{
    const unmount=f.runtime.select('a');f.runtime.attach(f.target);await f.runtime.ready;unmount();f.runtime.select('b');
    f.a.events.set({entries:[event('user/message',user('u','问题')),event('assistant/message',{turn:1,step:1,message:{id:'reply',content:[{type:'text',text:'原会话回答'}]}})]});
    await f.runtime.publish();
    assert.equal(f.runtime.target.sessionId,'a');assert.ok(f.snapshots.at(-1).text.includes('原会话回答'));assert.deepEqual(f.calls.release,[]);
  }finally{f.runtime.dispose();}assert.deepEqual(f.calls.release,['a']);assert.equal(f.a.events.count(),0);
});
test('repeated command delivery and lost receipt do not resend',async()=>{
  const f=fixture();try{
    const command={bindingId:f.target.id,sessionId:'a',requestId:'r1',action:'send',question:'x',image:null};
    f.setResponse({target:f.target,command,ack:[]});await f.runtime.poll();await flush();await f.runtime.poll();await flush();
    assert.equal(f.calls.send.length,1);assert.equal(f.runtime.receipts.get('r1').status,'accepted');
    f.setResponse({target:f.target,command:null,ack:['r1']});await f.runtime.poll();assert.equal(f.runtime.receipts.size,0);
  }finally{f.runtime.dispose();}
});
test('explicit rebind unsubscribes/releases old session and ignores stale updates',async()=>{
  const f=fixture();try{
    f.runtime.attach(f.target);await f.runtime.ready;f.runtime.attach({...f.target,id:'binding-b',sessionId:'b'});await f.runtime.ready;
    assert.deepEqual(f.calls.release,['a']);assert.equal(f.a.events.count(),0);assert.equal(f.b.events.count(),1);
    await f.runtime.execute({bindingId:'binding-a',sessionId:'a',requestId:'old',question:'x',action:'send'});
    assert.equal(f.calls.send.length,0);assert.equal(f.runtime.receipts.get('old').status,'failed');
  }finally{f.runtime.dispose();}
});
test('stop cancels pinned session and removed session refuses sending',async()=>{
  const f=fixture();try{
    f.runtime.attach(f.target);await f.runtime.ready;f.runtime.select('b');
    await f.runtime.execute({bindingId:f.target.id,sessionId:'a',requestId:'stop',action:'stop'});
    assert.equal(f.calls.cancel,1);assert.equal(f.runtime.receipts.get('stop').status,'stopped');
    f.a.state.set({...f.a.state.getSnapshot(),removed:true});
    await f.runtime.execute({bindingId:f.target.id,sessionId:'a',requestId:'send',action:'send',question:'x'});
    assert.equal(f.runtime.receipts.get('send').status,'failed');assert.equal(f.calls.send.length,0);
  }finally{f.runtime.dispose();}
});
test('connection recovery reacquires subscription but never repeats send',async()=>{
  const f=fixture();try{
    f.setResponse({target:f.target,command:null,ack:[]});f.runtime.start();await flush();
    f.connection.state.set('disconnected');await f.runtime.publish();assert.equal(f.snapshots.at(-1).status,'disconnected');
    f.connection.state.set('connected');f.connection.generation.set({id:2});await f.runtime.ready;
    assert.deepEqual(f.calls.retain,['a','a']);assert.deepEqual(f.calls.release,['a']);assert.equal(f.calls.send.length,0);
  }finally{f.runtime.dispose();}
});
test('long transcript publication chunks payload without text loss',async()=>{
  const f=fixture();try{
    f.runtime.attach(f.target);await f.runtime.ready;await f.runtime.publish();f.snapshots.length=0;
    const text='很长的回答😀\n'.repeat(5000);f.runtime.queueSnapshot({title:'A',status:'complete',running:false,error:'',text});await f.runtime.publish();
    assert.ok(f.snapshots.length>1);assert.equal(f.snapshots.map(s=>s.text).join(''),text);
  }finally{f.runtime.dispose();}
});
test('disposing during initial open does not attach listeners or send',async()=>{
  const f=fixture();f.runtime.attach(f.target);f.runtime.dispose();await flush();assert.equal(f.a.events.count(),0);assert.deepEqual(f.calls.release,['a']);
});
