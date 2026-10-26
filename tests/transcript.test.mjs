import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTranscript,textFrames } from '../src/transcript.mjs';
import { bindingFixture,event,user } from './helpers.mjs';
test('shows only the most recent twenty user/assistant messages; skips skill injections',()=>{
  const f=bindingFixture(); const entries=Array.from({length:25},(_,i)=>event('user/message',user('u'+i,'消息'+i),i));
  entries.push(event('user/message',{...user('skill','不应显示'),source:{kind:'skill-invocation'}},26));
  f.events.set({entries}); const result=projectTranscript(f.binding,'A');
  assert.equal(result.messages.length,20); assert.equal(result.messages[0].id,'u5'); assert.ok(!result.text.includes('不应显示'));
});
test('streaming block-end replaces accumulated deltas; durable settlement has no duplicate',()=>{
  const f=bindingFixture(); const chunk=c=>event('assistant/live-chunk',{turn:1,step:1,attemptId:'attempt',chunk:c});
  const entries=[event('user/message',user('u','问题')),chunk({type:'text-delta',index:0,text:'你'}),chunk({type:'text-delta',index:0,text:'好'}),chunk({type:'block-end',index:0,block:{type:'text',text:'你好'}})];
  f.events.set({entries}); assert.equal(projectTranscript(f.binding,'A').messages.at(-1).text,'你好');
  entries.push(event('assistant/message',{turn:1,step:1,message:{id:'answer',content:[{type:'text',text:'你好'}]}}));
  f.events.set({entries}); const result=projectTranscript(f.binding,'A'); assert.equal(result.messages.length,2); assert.equal(result.messages.at(-1).id,'answer');
});
test('queued and optimistic messages remain visible without duplicating admitted messages',()=>{
  const f=bindingFixture(); f.inbox.set({'next-turn':[user('q','下一条')]});
  f.state.set({...f.state.getSnapshot(),pendingSubmissions:[{requestId:'r',text:'发送中',attachments:[]}]});
  const result=projectTranscript(f.binding,'A'); assert.equal(result.status,'queued'); assert.equal(result.messages.length,2);
});
test('status distinguishes generation, cancellation, failure, missing session and offline state',()=>{
  const f=bindingFixture(); f.state.set({...f.state.getSnapshot(),running:true}); assert.equal(projectTranscript(f.binding,'A').status,'generating');
  f.state.set({...f.state.getSnapshot(),running:false}); f.events.set({entries:[event('turn/end',{reason:'cancelled'})]}); assert.equal(projectTranscript(f.binding,'A').status,'stopped');
  f.state.set({...f.state.getSnapshot(),lastAgentError:'模型报错'}); assert.equal(projectTranscript(f.binding,'A').error,'模型报错');
  f.state.set({...f.state.getSnapshot(),removed:true}); assert.equal(projectTranscript(f.binding,'A').status,'unavailable');
  assert.equal(projectTranscript(f.binding,'A','disconnected').status,'disconnected');
});
test('long Unicode replies are losslessly chunked without splitting surrogate pairs',()=>{
  const original=('长回复\n代码() 😀\n').repeat(10000); const frames=textFrames(original);
  assert.ok(frames.length>2); assert.ok(frames.every(x=>x.length<=8000&&!/[\uD800-\uDBFF]$/.test(x)));
  assert.equal(frames.join(''),original); assert.deepEqual(textFrames(''),['']);
});
