import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliver } from '../src/deliver.mjs';
import { bindingFixture } from './helpers.mjs';
function fixture() {
  const f = bindingFixture(); const calls=[];
  const mainDraft={text:'未发送的旧草稿',attachments:['old-image']};
  const conversation={createDrafts:(id,files)=>{calls.push(['create',id,files]);return [{id:'new-image'}];},sendSession:async(...args)=>{calls.push(['send',...args]);return {kind:'success'};},releaseDraftAttachments:d=>calls.push(['release',d])};
  return { ...f,calls,mainDraft,env:{binding:f.binding,conversation,makeFile:()=> 'screenshot'} };
}
const item={sessionId:'a',question:'问题',image:'png'};
test('direct send uses only popup attachments and never changes main draft',async()=>{
  const f=fixture(); assert.deepEqual(await deliver(item,f.env),{status:'accepted'});
  const call=f.calls.find(c=>c[0]==='send');
  assert.deepEqual(call.slice(2),['问题',['new-image'],'queue']);
  assert.deepEqual(f.mainDraft,{text:'未发送的旧草稿',attachments:['old-image']});
});
test('text-only follow-up skips attachment intake',async()=>{
  const f=fixture(); await deliver({...item,image:null},f.env);
  assert.equal(f.calls[0][0],'send'); assert.deepEqual(f.calls[0][3],[]);
});
test('wrong or removed session never sends',async()=>{
  const f=fixture(); await assert.rejects(deliver({...item,sessionId:'b'},f.env));
  f.state.set({...f.state.getSnapshot(),removed:true});
  assert.equal((await deliver(item,f.env)).status,'failed'); assert.equal(f.calls.length,0);
});
test('busy session queues rather than interrupts',async()=>{
  const f=fixture(); f.state.set({...f.state.getSnapshot(),running:true});
  assert.equal((await deliver(item,f.env)).status,'accepted');
  assert.equal(f.calls.find(c=>c[0]==='send').at(-1),'queue');
});
test('known rejection releases temporary attachments',async()=>{
  const f=fixture(); f.env.conversation.sendSession=async()=>({kind:'error'});
  assert.equal((await deliver(item,f.env)).status,'failed'); assert.equal(f.calls.at(-1)[0],'release');
});
test('transport ambiguity never retries and preserves native source for manual checking',async()=>{
  const f=fixture(); let count=0; f.env.conversation.sendSession=async()=>{count++;throw new Error('connection lost');};
  assert.equal((await deliver(item,f.env)).status,'unknown'); assert.equal(count,1); assert.equal(item.image,'png');
});
test('local image preparation failure is definite, not an ambiguous send',async()=>{
  const f=fixture(); f.env.makeFile=()=>{throw new Error('decode');};
  assert.equal((await deliver(item,f.env)).status,'failed'); assert.equal(f.calls.length,0);
});
