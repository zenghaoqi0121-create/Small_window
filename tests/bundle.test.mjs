import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('browser bundle is self-contained and declares resident session dependencies',async()=>{
  const code=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  let module;vm.runInNewContext(code,{window:{__ModuleLoader__:{load:value=>{module=value;}}}});
  assert.equal(module.id,'dsh-shichuang');const exports=module.factory(()=>({}));
  assert.equal(typeof exports.apply,'function');assert.ok(exports.inject.includes('sessions'));
});
