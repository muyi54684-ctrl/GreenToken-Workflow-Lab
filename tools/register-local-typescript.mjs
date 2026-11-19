// Compiler resolution only. Unlike offline-node.mjs this does not change networking.
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
let config={};
try{config=JSON.parse(readFileSync(new URL('../local-tools.json',import.meta.url),'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;}
if(config.typescript)registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='typescript')return {url:pathToFileURL(config.typescript).href,shortCircuit:true};
  return nextResolve(specifier,context);
}});
