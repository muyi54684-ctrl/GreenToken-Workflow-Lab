import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
const requireNative=createRequire(import.meta.url);
const project=fileURLToPath(new URL('../projects/script2video/',import.meta.url));
export function loadProject(overrides={}) {
  const cache=new Map();
  function load(id) {
    if(Object.hasOwn(overrides,id)) return overrides[id];
    if(['node:crypto','node:path','node:fs/promises'].includes(id)) return requireNative(id);
    if(cache.has(id)) return cache.get(id);
    if(!/^@\/(lib\/(greentoken\/[A-Za-z]+|providers\/(gemini|deepseek)|prompts\/storyboard|types)|config\/[a-zA-Z0-9.-]+\.json)$/.test(id)) throw new Error('Unexpected import '+id);
    const source=readFileSync(resolve(project,id.slice(2)+(id.endsWith('.json')?'':'.ts')),'utf8');
    if(id.endsWith('.json')) {const data=JSON.parse(source);cache.set(id,data);return data;}
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const exports={};cache.set(id,exports);
    new Script('(function(exports,require){'+code+'\n})',{filename:id}).runInThisContext()(exports,load);
    return exports;
  }
  return load;
}
export function implementationHash() {
  const files=['app/api/chat/route.ts','lib/providers/gemini.ts','lib/prompts/storyboard.ts','lib/types.ts',
    ...readdirSync(resolve(project,'lib/greentoken')).filter(n=>n.endsWith('.ts')).map(n=>'lib/greentoken/'+n),
    ...readdirSync(resolve(project,'config')).filter(n=>n.endsWith('.json')).map(n=>'config/'+n)].sort();
  const h=createHash('sha256');
  for(const path of files) { h.update(path+'\0');h.update(readFileSync(resolve(project,path)));h.update('\0'); }
  return h.digest('hex');
}
