'use strict';
const el=id=>document.getElementById(id);
let serverMode, current, busy=false;
async function api(path,body) {
  const response=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error);
  return data;
}
function displayButtons(){
  el('generate').disabled=busy || !serverMode || !el('script').value.trim();
  el('history').disabled=busy;
  el('freeze').disabled=busy || !current?.generation?.draft;
  document.querySelectorAll('[data-group]').forEach(box=>{
    const unavailable=!current?.frozen || current.mode!==serverMode || !!current.runs[box.dataset.group];
    if(unavailable)box.checked=false;
    box.disabled=busy || unavailable;
  });
  const selected=selection();
  el('run-selected').disabled=busy || selected.length===0;
  const calls=serverMode==='live'?selected.filter(name=>name!=='skip').length:0;
  el('request-count').textContent='所选新增 '+calls+' 次真实请求';
}
function selection(){return [...document.querySelectorAll('[data-group]:checked')].map(box=>box.dataset.group);}
async function perform(message,operation) {
  if(busy)return;
  busy=true;displayButtons();el('status').textContent=message;
  try {await operation();el('status').textContent='';}
  catch(e){el('status').textContent=e.message;}
  finally{busy=false;displayButtons();}
}
async function historyList(){
  const {mode,items}=await api('list');serverMode=mode;
  el('mode').textContent=mode==='offline'?'本地离线演练':'真实调用模式';
  el('live-entry').hidden=mode!=='offline';
  el('hint').textContent=mode==='offline'?'演练按标点拆分输入，Review 返回演练初稿，真实模型调用为 0。':'模型 deepseek-v4-pro。生成初稿会发起一次真实请求。';
  const select=el('history');select.replaceChildren(new Option('雨夜校园 · 历史真实对照','archive'));
  for(const e of items)select.add(new Option((e.mode==='offline'?'演练':'真实')+' · '+e.title+' · '+new Date(e.created).toLocaleTimeString(),e.id));
  if(current)select.value=current.id;
  return items;
}
async function display(e){
  if(current?.id!==e.id)document.querySelectorAll('[data-group]').forEach(box=>{box.checked=false;});
  current=e;el('history').value=e.id;el('session').hidden=false;
  remember(e.id);
  el('stamp').textContent=(e.mode==='offline'?'离线演练':'真实实验')+' · '+new Date(e.created).toLocaleString();
  el('source').textContent=e.script;
  const g=e.generation;
  const draft=g?.draft;
  el('generation-info').textContent=!g?'生成请求已登记，暂未取得结果。':g.failure?'生成失败 · '+g.failure:('初稿 D · '+draft.shots.length+' 镜 · '+draft.totalDurationSec+' 秒'+(e.frozen?' · 已冻结':' · 待冻结'));
  el('draft').replaceChildren();
  for(const shot of draft?.shots??[]){const li=document.createElement('li');li.textContent=shot.durationSec+' 秒 · '+shot.summary;el('draft').append(li);}
  el('freeze').hidden=!!e.frozen||!draft;
  el('controls').hidden=!e.frozen;
  el('runs').textContent=Object.entries(e.runs).map(([k,r])=>k+' · '+(r.status==='reserved'?'已登记，结果待核对':r.failure?'异常 '+r.failure:'完成')).join('　');
  el('export').hidden=!Object.values(e.runs).some(r=>r.status!=='reserved');
  el('download').href='/api/'+e.id+'/replay';
  el('comparison').replaceChildren();
  if(e.frozen)showComparison(el('comparison'),await api(e.id+'/view'));
  displayButtons();
}
function confirmation(label){
  return serverMode==='offline'||confirm(label+'将向 deepseek-v4-pro 发起 1 次真实请求，按实际用量计费。确认执行？');
}
function remember(id){
  const url=new URL(location.href);
  url.searchParams.set('experiment',id);
  window.history.replaceState(null,'',url);
}
async function openExperiment(id){
  if(id!=='archive')return display(await api(id));
  const archive=await api('archive/view');
  current=null;
  el('session').hidden=true;
  el('history').value='archive';
  el('download').href='/api/archive/replay';
  el('export').hidden=false;
  showComparison(el('comparison'),archive);
  remember('archive');
}
el('script').oninput=displayButtons;
el('generate').onclick=()=>{
  if(!confirmation('生成初稿'))return;
  const id=crypto.randomUUID();
  perform('生成中，请等待本次请求完成。',async()=>{
    const e=await api('generate',{id,script:el('script').value,language:el('language').value,confirmation:serverMode==='live'?'deepseek-v4-pro':null});
    await historyList();await display(e);
  });
};
el('history').onchange=()=>perform('正在打开记录…',()=>openExperiment(el('history').value));
el('freeze').onclick=()=>perform('正在冻结…',async()=>display(await api('freeze',{id:current.id})));
document.querySelectorAll('[data-group]').forEach(box=>box.onchange=displayButtons);
el('run-selected').onclick=()=>{
  const selected=selection();
  const calls=selected.filter(group=>group!=='skip').length;
  if(serverMode==='live' && calls && !confirm('运行 '+selected.join('、')+'，共 '+calls+' 次真实 Review 请求，按实际用量计费。继续？'))return;
  const id=current.id;
  perform('准备对照…',async()=>{
    for(const group of selected){
      el('status').textContent='正在运行 '+group+'，已完成的结果会先显示在下方。';
      await display(await api('run',{id,group,confirmation:serverMode==='live'?'deepseek-v4-pro':null}));
    }
    el('comparison').scrollIntoView({block:'start'});
  });
};
perform('正在读取实验记录…',async()=>{
  const items=await historyList();
  const requested=new URL(location.href).searchParams.get('experiment');
  const id=items.some(item=>item.id===requested)?requested:'archive';
  await openExperiment(id);
});

