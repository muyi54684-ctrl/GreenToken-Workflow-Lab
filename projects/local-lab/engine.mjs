import '../../tools/register-local-typescript.mjs';
import { mkdir, readFile, readdir, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const {loadProject} = await import('../../tools/load-script2video.mjs');
const load = loadProject();
const { generateContent } = load('@/lib/providers/deepseek');
const { deepSeekCost } = load('@/lib/greentoken/deepseekMetrics');
const prompts = load('@/lib/prompts/storyboard');
const { buildBaseline, planDeepSeek, assertOnlyEffort } = load('@/lib/greentoken/deepseekReview');
const { normalizeDialogueAndSubtitle } = load('@/lib/greentoken/reviewFinal');
const { observeStructure } = load('@/lib/greentoken/geminiReview');
const { hash, assertSafe } = load('@/lib/greentoken/experimentData');
export const MODEL = 'deepseek-v4-pro';
export const groups = ['baseline', 'low', 'skip'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const now = () => new Date().toISOString();

export function requireValue(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
async function read(dir, name) {
  try { return JSON.parse(await readFile(join(dir, name + '.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
// Publish complete JSON without replacing an existing file, even across processes.
async function save(dir, name, value) {
  const temp = join(dir, randomUUID() + '.tmp');
  await writeFile(temp, JSON.stringify(value, null, 2), {flag:'wx', mode:0o600});
  try { await link(temp, join(dir, name + '.json')); }
  catch (e) { if (e.code === 'EEXIST') requireValue(false,'该操作已有记录，请刷新查看。',409); throw e; }
  finally { await unlink(temp); }
}
function validateSchema(value, schema) {
  switch (schema.type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
      && schema.required.every(k => Object.hasOwn(value,k))
      && Object.entries(schema.properties).every(([k, child]) => !Object.hasOwn(value,k) || validateSchema(value[k],child));
    case 'array': return Array.isArray(value) && value.every(v => validateSchema(v,schema.items));
    case 'integer': return Number.isSafeInteger(value);
    case 'string': return typeof value === 'string';
    default: return false;
  }
}
function validDraft(d,c) {
  return validateSchema(d,prompts.STORYBOARD_RESPONSE_SCHEMA) && d.shots.length > 0 &&
    d.shots.every((s,i) => s.index === i+1 && c.allowedDurations.includes(s.durationSec) &&
      s.summary.trim() && s.veoPrompt.trim() && s.camera.trim() &&
      s.dialogue.every(line => line.speaker.trim() && line.line.trim())) &&
    d.totalDurationSec === d.shots.reduce((n,s)=>n+s.durationSec,0);
}
function rehearsalDraft(script,c) {
  const lines = script.match(/[^。！？.!?\n]+[。！？.!?]?/gu) || [script];
  const shots = lines.filter(line=>line.trim()).slice(0,8).map((summary,i)=>({
    index:i+1,durationSec:4,summary:summary.trim(),veoPrompt:'Offline placeholder shot '+(i+1),
    camera:'固定镜头（演练）',composition:'中景',ambiance:'环境声',sfx:[],subtitle:'',dialogue:[]
  }));
  return {detectedStyle:'本地演练模板', language:c.language, totalDurationSec:4*shots.length, shots};
}
function assertInputSafe(value, key) {
  try { assertSafe(value); }
  catch { requireValue(false,'输入含不适合保存的凭据信息。'); }
  requireValue(!(key && JSON.stringify(value).includes(key)) && !/\bsk-[\w-]{12,}/.test(JSON.stringify(value)), '输入含疑似凭据。');
}
export function createLab(root, {live=false, transport}={}) {
  const mode = live ? 'live' : 'offline';
  const key = () => live ? process.env.DEEPSEEK_API_KEY?.trim() : undefined;
  const directory = id => { requireValue(uuid.test(id), '实验编号无效。'); return join(root,id); };
  async function get(id) {
    const dir=directory(id), experiment=await read(dir,'experiment');
    requireValue(experiment, '找不到实验。',404);
    const runs={};
    for (const group of groups) {
      const intent=await read(dir,group+'-intent');
      if (intent) runs[group]=await read(dir,group) ?? {status:'reserved',started:intent.started,D:intent.D};
    }
    return {...experiment, generation:await read(dir,'generation'), frozen:await read(dir,'frozen'),runs};
  }
  function authorize(confirmation) {
    if (!live) return;
    requireValue(confirmation === MODEL, '需要单独确认本次真实调用。',403);
    requireValue(key(), '本机未配置 DeepSeek Key。',409);
  }
  async function invoke(parameters, offlineAnswer, callId) {
    const runtime = {callId, timeoutMs:600000};
    if (live) runtime.allowLive=true;
    else {
      runtime.credential=()=>'OFFLINE_FIXTURE_CREDENTIAL';
      runtime.transport=transport ?? (async()=>Response.json({model:MODEL,choices:[{
        finish_reason:'stop', message:{content:JSON.stringify(offlineAnswer())}
      }]}));
    }
    const response=await generateContent(parameters,runtime);
    const {text,raw_response_body,...diagnostics}=response;
    const {messages,...settings}=parameters;
    return {text,record:{...diagnostics,...deepSeekCost(response.model,response.raw_usage),
      settings,promptHash:hash(messages),source:mode,realRequests:live && response.request_sent ? 1 : 0}};
  }
  async function generate({id,script,language='zh-CN',confirmation}) {
    const dir=directory(id);
    requireValue(typeof script==='string' && script.trim() && script.length<=12000,'请输入 1–12000 字符的剧本。');
    requireValue(['zh-CN','en-US'].includes(language),'不支持的对白语言。');
    assertInputSafe(script,key());
    authorize(confirmation);
    const constraints={durationSec:8,allowedDurations:[4,6,8],language,aspectRatio:'16:9',withSubtitle:true};
    const parameters={model:MODEL, temperature:0.7,stream:false,response_format:{type:'json_object'},
      messages:[{role:'system',content:prompts.STORYBOARD_SYSTEM_PROMPT+'\nStoryboard JSON schema:\n'+JSON.stringify(prompts.STORYBOARD_RESPONSE_SCHEMA)},
        {role:'user',content:prompts.buildStoryboardUserPrompt({script,...constraints})}]};
    await mkdir(root,{recursive:true});
    try { await mkdir(dir); } catch(e) { if(e.code==='EEXIST') requireValue(false,'该生成请求已经登记。',409); throw e; }
    const callId=randomUUID();
    await save(dir,'experiment',{id,mode,created:now(),model:MODEL,script,constraints,generationCallId:callId});
    const {text,record}=await invoke(parameters,()=>rehearsalDraft(script,constraints),callId);
    let draft=null, failure=record.failure_kind;
    if (!failure) {
      try {
        const parsed=prompts.parseStoryboard(text);
        assertInputSafe(parsed,key());
        if(validDraft(parsed,constraints)) draft=parsed;
        else failure='invalid_draft_structure';
      } catch {failure='invalid_draft_content';}
    }
    await save(dir,'generation',{status:draft?'ready':'failed',failure,record,draft});
    return get(id);
  }
  function binding(e) { return hash({script:e.script,constraints:e.constraints,draft:e.generation.draft,mode:e.mode,model:e.model}); }
  async function freeze(id) {
    const e=await get(id);
    requireValue(e.generation?.status==='ready','只有通过基础检查的初稿可以冻结。',409);
    if(!e.frozen) await save(directory(id),'frozen',{at:now(),binding:binding(e),D:hash(e.generation.draft)});
    return get(id);
  }
  async function run(id,group,confirmation) {
    requireValue(groups.includes(group),'未知策略。');
    const e=await get(id), dir=directory(id);
    requireValue(e.mode===mode,'请在该实验原来的模式下运行。',409);
    requireValue(e.frozen && e.frozen.binding===binding(e),'需要有效的冻结初稿。',409);
    requireValue(!e.runs[group],'该策略已有记录，不能重复执行。',409);
    const D=e.generation.draft,c=e.constraints, started=now(),callId=group==='skip'?null:randomUUID();
    let parameters=null,decision=null;
    if (group!=='skip') {
      authorize(confirmation);
      const baseline=buildBaseline(D,c);
      decision=planDeepSeek(group==='low'?'optimized':'baseline',baseline);
      parameters=decision?.parameters ?? baseline;
      if(decision) assertOnlyEffort(baseline,parameters);
    }
    await save(dir,group+'-intent',{started,D:e.frozen.D,callId,group});
    let record=null,R=null,F=null,adopted=false,failure=null,structure=null,parsed=false;
    if(parameters) {
      const response=await invoke(parameters,()=>D,callId);
      record=response.record;
      failure=record.failure_kind;
      if(!failure) {
        try { R=prompts.parseStoryboard(response.text); assertInputSafe(R,key()); parsed=true; structure=observeStructure(R); adopted=true; }
        catch { R=null; failure='review_parse_failed'; }
      }
    }
    try { F=normalizeDialogueAndSubtitle(adopted?R:D,c.language,c.withSubtitle); }
    catch {failure='normalization_failed';}
    await save(dir,group,{status:failure?'failed':'complete',group,started,D:e.frozen.D,callId,record,
      policy:decision?.policy_id ?? null,changes:decision?.changes ?? [],parsed,structure,adopted,
      failure,finalSource:F?(adopted?'review':'draft'):null,R,F});
    return get(id);
  }
  async function list() {
    await mkdir(root,{recursive:true});
    const entries=await readdir(root,{withFileTypes:true});
    const items=[];
    for(const item of entries.filter(x=>x.isDirectory()&&uuid.test(x.name))) {
      const e=await read(directory(item.name),'experiment');
      if(e) items.push({id:e.id,created:e.created,title:e.script.slice(0,42),mode:e.mode});
    }
    return items.sort((a,b)=>b.created.localeCompare(a.created));
  }
  return {mode,list,get,generate,freeze,run};
}

