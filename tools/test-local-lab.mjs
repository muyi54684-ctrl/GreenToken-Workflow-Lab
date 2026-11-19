import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLab} from '../projects/local-lab/engine.mjs';
import {createServer} from '../projects/local-lab/server.mjs';
import {publicReplay} from '../projects/local-lab/replay.mjs';

async function folder(t){
  const root=await mkdtemp(join(tmpdir(),'gtlab-'));
  t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
const sample={detectedStyle:'写实',language:'zh-CN',totalDurationSec:4,shots:[{index:1,durationSec:4,
  summary:'女孩关掉台灯。',veoPrompt:'Lamp dims.',sfx:[],camera:'中景',composition:'桌边',ambiance:'安静',
  dialogue:[{speaker:'女孩',line:'晚安。'}],subtitle:''}]};
function wire(content){return Response.json({model:'deepseek-v4-pro',usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30,
  completion_tokens_details:{reasoning_tokens:8},prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:10},
  choices:[{finish_reason:'stop',message:{content}}]});}
test('operator HTTP workflow: generation once, freeze, skip, independent real policy branches and portable replay',async t=>{
  const root=await folder(t),sent=[];
  const lab=createLab(root,{transport:async(url,init)=>{
    sent.push(JSON.parse(init.body));
    const d=structuredClone(sample);
    if(sent.length>1)d.shots[0].summary=sent.at(-1).reasoning_effort?'轻量修订':'原始审核修订';
    return wire(JSON.stringify(d));
  }});
  const server=createServer(lab);
  await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));
  t.after(()=>new Promise(ok=>server.close(ok)));
  const origin='http://127.0.0.1:'+server.address().port;
  const archive=await (await fetch(origin+'/api/archive/view')).json();
  assert.equal(archive.runs.baseline.metrics.total,15691);
  assert.equal(archive.runs.low.metrics.reasoning,5452);
  assert.equal(archive.generation,null);
  assert.deepEqual(archive.runs.skip.F,archive.D);
  assert.equal(archive.runs.skip.metrics,null);
  assert.equal((await fetch(origin+'/showcase/index.html')).status,200);
  const archiveHtml=await (await fetch(origin+'/api/archive/replay')).text();
  assert.ok(archiveHtml.includes('较 Baseline'));
  assert.equal(sent.length,0);
  const post=(path,body,from=origin)=>fetch(origin+'/api/'+path,{method:'POST',headers:{origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const id=randomUUID(),script='她把灯关上，对着窗户说晚安。 </script><img src=x>';
  assert.equal((await post('generate',{id,script},'http://example.invalid')).status,403);
  const generated=await (await post('generate',{id,script})).json();
  assert.equal(generated.generation.status,'ready');assert.ok(sent[0].messages[1].content.includes(script));assert.equal(sent.length,1);
  assert.equal((await post('generate',{id,script})).status,409);
  assert.equal((await post('run',{id,group:'low'})).status,409);
  const frozen=await (await post('freeze',{id})).json();
  const skip=await (await post('run',{id,group:'skip'})).json();
  assert.equal(sent.length,1);assert.equal(skip.runs.skip.R,null);assert.equal(skip.runs.skip.F.shots[0].subtitle,'晚安。');
  for(const group of ['baseline','low']) {
    const results=await Promise.all([post('run',{id,group}),post('run',{id,group})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  }
  assert.equal(sent.length,3);
  assert.deepEqual(sent[2],{...sent[1],reasoning_effort:'low'});
  const loaded=await createLab(root).get(id);
  for(const run of Object.values(loaded.runs))assert.equal(run.D,frozen.frozen.D);
  assert.equal(loaded.runs.baseline.R.shots[0].summary,'原始审核修订');
  assert.equal(loaded.runs.low.F.shots[0].summary,'轻量修订');
  assert.equal(loaded.runs.low.record.reference_cost_usd,0.0000924);
  assert.equal(loaded.runs.low.record.realRequests,0);
  const response=await fetch(origin+'/api/'+id+'/replay');
  assert.match(response.headers.get('content-disposition'),/attachment/);
  const html=await response.text();assert.ok(!html.includes('</script><img src=x>'));
  const embedded=JSON.parse(html.match(/id="replay-data">([^<]+)<\/script>/)[1]);
  assert.deepEqual(embedded,publicReplay(loaded));assert.equal(embedded.mode,'offline');
  assert.ok(!html.includes('OFFLINE_FIXTURE_CREDENTIAL'));
  assert.match(html,/default-src 'none'/);
});
test('generation rejects malformed structure or inconsistent duration; no Review follows',async t=>{
  const root=await folder(t);
  for(const content of ['  ','oops',JSON.stringify({...sample,totalDurationSec:7}),JSON.stringify({...sample,shots:[{}]})]) {
    let count=0;const lab=createLab(root,{transport:async()=>{count++;return wire(content);}});
    const e=await lab.generate({id:randomUUID(),script:'一段剧本'});
    assert.equal(e.generation.status,'failed');await assert.rejects(lab.freeze(e.id));assert.equal(count,1);
  }
});
test('failed review keeps usage and original Final fallback; no retry',async t=>{
  let count=0;const root=await folder(t);
  const lab=createLab(root,{transport:async()=>wire(++count===1?JSON.stringify(sample):'bad json')});
  const {id}=await lab.generate({id:randomUUID(),script:'关灯'});await lab.freeze(id);
  const e=await lab.run(id,'low');const r=e.runs.low;
  assert.equal(r.failure,'review_parse_failed');assert.equal(r.finalSource,'draft');assert.equal(r.record.total_tokens,30);
  assert.equal(r.F.shots[0].subtitle,'晚安。');await assert.rejects(lab.run(id,'low'));assert.equal(count,2);
  assert.equal(publicReplay(e).runs.low.failure,'review_parse_failed');
});
test('tampering blocks any branch, including skip; live confirmation fails before transport',async t=>{
  const root=await folder(t);const lab=createLab(root);
  const {id}=await lab.generate({id:randomUUID(),script:'小鸟落在窗台。'});await lab.freeze(id);
  const path=join(root,id,'generation.json'),g=JSON.parse(await readFile(path));g.draft.shots[0].summary='改动';
  await writeFile(path,JSON.stringify(g));await assert.rejects(lab.run(id,'skip'),/冻结/);
  await assert.rejects(createLab(root,{live:true}).generate({id:randomUUID(),script:'无授权'}),/单独确认/);
});

