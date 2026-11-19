import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const digest = text => createHash('sha256').update(text).digest('base64');
function board(value) {
  if (!value || !Array.isArray(value.shots)) return null;
  return {duration:value.totalDurationSec,shots:value.shots.map(s=>({
    index:s?.index, duration:s?.durationSec, summary:s?.summary, camera:s?.camera, subtitle:s?.subtitle,
    prompt:s?.veoPrompt, dialogue:Array.isArray(s?.dialogue)?s.dialogue.map(d=>({speaker:d?.speaker,line:d?.line})):[]
  }))};
}
function metrics(record) {
  if (!record) return null;
  return {input:record.input_tokens,output:record.output_tokens,reasoning:record.reasoning_tokens,
    total:record.total_tokens,cost:record.reference_cost_usd,price:record.price_version,ms:record.latency_ms,
    model:record.model,request:record.settings,call:record.call_id,http:record.http_status,
    finish:record.finish_reason,requests:record.realRequests,promptHash:record.promptHash};
}
export function publicReplay(e) {
  const runs={};
  for (const [name,r] of Object.entries(e.runs)) {
    if(r.status==='reserved') continue;
    runs[name]={name,status:r.status,failure:r.failure,finalSource:r.finalSource,adopted:r.adopted,
      draftHash:r.D,metrics:metrics(r.record),R:board(r.R),F:board(r.F)};
  }
  return {version:1,id:e.id,mode:e.mode,model:e.model,script:e.script,date:e.created,D:board(e.generation?.draft),
    frozen:e.frozen?.D, generation:metrics(e.generation?.record), constraints:e.constraints,runs};
}
export async function renderReplay(e) {
  return renderPublicReplay(publicReplay(e));
}
export async function renderPublicReplay(data) {
  const code=(await readFile(new URL('viewer.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const css=await readFile(new URL('style.css',import.meta.url),'utf8');
  const json=JSON.stringify(data).replaceAll('<','\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${digest(code)}'; base-uri 'none'; form-action 'none'"><title>GreenToken · 分镜实验回放</title><style>${css}</style></head><body><main><header><b>GreenToken / 分镜实验回放</b></header><h1>同一份初稿的策略对照</h1><div id="comparison"></div></main><script type="application/json" id="replay-data">${json}</script><script>${code}</script></body></html>`;
}

