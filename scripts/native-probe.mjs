// Local UI integration fixture. Never connects to a model or modifies Harness.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const child = spawn(fileURLToPath(new URL('../native/Shichuang.exe', import.meta.url)), ['--diagnostic'], { windowsHide:true, stdio:['pipe','pipe','inherit'] });
console.log(JSON.stringify({event:'started',pid:child.pid}));
const send = message => child.stdin.write(JSON.stringify(message)+'\n');
const bindingId='local-ui-probe';
createInterface({input:child.stdout}).on('line',line=>{
  const m=JSON.parse(line);
  console.log(JSON.stringify({event:m.type,stage:m.stage,kind:m.kind}));
  if(m.type==='ready') {
    send({type:'show',bindingId,title:'本地功能测试（不连接模型）'});
    const text='你\n[图片]\n请分析这张截图。\n\n────────────────\n\n助手\n这是本地测试回复，用于验证浮窗显示和复制。\n代码保留原文：\nconsole.log("hello");\n\n可以输入测试消息，验证直接发送后浮窗保持显示。';
    send({type:'transcript',bindingId,revision:1,index:0,total:1,text,status:'complete',running:false,title:'本地功能测试（不连接模型）'});
  }
  if(m.type==='submit') {
    console.log(JSON.stringify({event:'submit',requestId:m.requestId,hasImage:!!m.image,question:m.question}));
    send({type:'receipt',bindingId,requestId:m.requestId,status:'accepted'});
    send({type:'transcript',bindingId,revision:Date.now(),index:0,total:1,text:'你\n'+(m.image?'[图片]\n':'')+(m.question.trim()||'请分析这张截图。')+'\n\n助手\n已验证本地直接发送；未请求真实模型。',status:'complete',running:false,title:'本地功能测试（不连接模型）'});
  }
});
child.on('exit',code=>process.exit(code??0));
process.stdin.on('data',chunk=>{ if(chunk.toString().trim()==='quit'){send({type:'quit'});setTimeout(()=>child.kill(),1000).unref();} });
process.on('SIGINT',()=>send({type:'quit'}));
