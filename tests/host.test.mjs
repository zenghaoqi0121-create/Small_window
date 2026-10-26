import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough,Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { attachHost } from '../src/host.mjs';
function fixture(rejection) {
  const child=new EventEmitter(); child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.kill=()=>child.emit('exit',0);
  const messages=[]; let text=''; child.stdin.on('data',chunk=>{text+=chunk;let i;while((i=text.indexOf('\n'))>=0){messages.push(JSON.parse(text.slice(0,i)));text=text.slice(i+1);}});
  let route,removed=false;
  const ctx={get:()=>({requestRejection:()=>rejection}),logger:{warn(){}},webServer:{register(r){route=r;return()=>{removed=true;};}}};
  const dispose=attachHost(ctx,()=>child);
  async function request(body,method='POST') {
    const req=Readable.from([JSON.stringify(body)]);req.method=method;req.socket={remoteAddress:'127.0.0.1'};
    let status,data;await route.handler(req,{writeHead(s){status=s;},end(v){data=JSON.parse(v);}});return{status,data};
  }
  return{child,messages,request,native:m=>child.stdout.write(JSON.stringify(m)+'\n'),dispose:()=>{dispose();child.emit('exit',0);child.stdin.end();child.stdout.end();child.stderr.end();assert.equal(removed,true);}};
}
test('native submit -> resident client -> accepted receipt keeps pinned target',async()=>{
  const f=fixture();try {
    await f.request({action:'open',clientId:'one',sessionId:'a',title:'原会话'});
    const show=f.messages.at(-1);assert.equal(show.type,'show');
    f.native({type:'submit',bindingId:show.bindingId,requestId:'r1',question:'问题'});
    assert.equal(f.messages.at(-1).type,'sending');
    const sync=await f.request({action:'sync',clientId:'one',sessionId:'b'});
    assert.equal(sync.data.command.sessionId,'a');assert.equal(sync.data.target.title,'原会话');
    assert.equal((await f.request({action:'sync',clientId:'one',sessionId:'b'})).data.command,null);
    const receipt={bindingId:show.bindingId,requestId:'r1',status:'accepted'};
    await f.request({action:'sync',clientId:'one',sessionId:'b',receipts:[receipt]});
    assert.equal(f.messages.at(-1).status,'accepted');
    const count=f.messages.length;await f.request({action:'sync',clientId:'one',receipts:[receipt]});assert.equal(f.messages.length,count);
  }finally{f.dispose();}
});
test('transcript frames are session-scoped, support long chunks and cannot cross clients',async()=>{
  const f=fixture();try {
    await f.request({action:'open',clientId:'one',sessionId:'a'});const {bindingId}=f.messages.at(-1);
    const update={action:'update',clientId:'one',bindingId,revision:1,index:0,total:2,text:'字'.repeat(8000),status:'generating',running:true};
    assert.equal((await f.request(update)).status,200);assert.equal(f.messages.at(-1).text.length,8000);
    assert.equal((await f.request({...update,clientId:'other'})).status,409);
    assert.equal((await f.request({...update,index:2})).status,400);
    assert.equal((await f.request({...update,text:'x'.repeat(8001)})).status,400);
  }finally{f.dispose();}
});
test('native validation failures unlock retry without clearing input',async()=>{
  const f=fixture();try {
    await f.request({action:'open',clientId:'one',sessionId:'a'});const {bindingId}=f.messages.at(-1);
    f.native({type:'submit',bindingId,requestId:'r1',question:' '});
    assert.equal(f.messages.at(-1).retry,true);assert.equal(f.messages.at(-1).requestId,'r1');
  }finally{f.dispose();}
});
test('dirty native draft prevents explicit rebind; hidden hotkey open preserves binding',async()=>{
  const f=fixture();try {
    await f.request({action:'open',clientId:'one',sessionId:'a'});const {bindingId}=f.messages.at(-1);
    f.native({type:'dirty',bindingId,dirty:true});
    assert.equal((await f.request({action:'open',clientId:'one',sessionId:'b'})).status,400);
    f.native({type:'open'});assert.equal(f.messages.at(-1).bindingId,bindingId);
    f.native({type:'dirty',bindingId,dirty:false});await f.request({action:'open',clientId:'one',sessionId:'b'});
    assert.notEqual(f.messages.at(-1).bindingId,bindingId);
  }finally{f.dispose();}
});
test('stop command routes to pinned session',async()=>{
  const f=fixture();try {
    await f.request({action:'open',clientId:'one',sessionId:'a'});const {bindingId}=f.messages.at(-1);
    f.native({type:'stop',bindingId,requestId:'stop1'});
    assert.equal((await f.request({action:'sync',clientId:'one',sessionId:'b'})).data.command.action,'stop');
  }finally{f.dispose();}
});
test('authentication, method and helper lifecycle errors are surfaced safely',async()=>{
  const f=fixture(401);try {assert.equal((await f.request({action:'open'})).status,401);assert.equal(f.messages.length,0);}finally{f.dispose();}
  const g=fixture();try{
    assert.equal((await g.request({},'GET')).status,405);
    g.child.emit('exit',1);
    assert.ok((await g.request({action:'sync',clientId:'one'})).data.error.includes('退出'));
  }finally{g.dispose();}
});
