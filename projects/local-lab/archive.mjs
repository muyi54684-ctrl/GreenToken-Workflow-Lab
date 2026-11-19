import {readFile} from 'node:fs/promises';

function storyboard(snapshot) {
  if (!snapshot) return null;
  return {duration:snapshot.duration, shots:snapshot.shots.map(shot=>({
    index:shot.index, duration:shot.durationSec, summary:shot.summary,
    camera:shot.camera, dialogue:shot.dialogue, subtitle:shot.subtitle
  }))};
}

// Project the measured showcase fixture into the same view used for new experiments.
export async function archivedCase() {
  const file=new URL('../showcase/evidence.json',import.meta.url);
  const source=JSON.parse(await readFile(file,'utf8'));
  const runs={};
  for(const [name,run] of Object.entries(source.runs)){
    const m=run.metrics;
    runs[name]={name,status:'complete',adopted:run.adopted,finalSource:run.finalSource,
      draftHash:source.draft.hash,R:storyboard(run.snapshots.R),F:storyboard(run.snapshots.F),
      metrics:name==='skip'?null:{input:m.input_tokens,output:m.output_tokens,reasoning:m.reasoning_tokens,
        total:m.total_tokens,cost:m.reference_cost_usd,price:source.priceVersion,ms:m.latency_ms,
        requests:run.calls,call:run.callId,http:run.httpStatus,finish:run.finishReason,
        model:source.model,request:run.parameters}};
  }
  return {version:1,id:'archive',mode:'historical',model:source.model,script:source.script,
    date:source.date,D:storyboard(source.draft),generation:null,frozen:source.draft.hash,runs};
}
