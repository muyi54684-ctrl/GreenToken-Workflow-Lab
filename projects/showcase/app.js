'use strict';
(() => {
  const data = window.GREENTOKEN_DATA;
  const operatorEntry = document.getElementById('operator-entry');
  if (location.protocol==='file:' || ['localhost','127.0.0.1'].includes(location.hostname)) {
    operatorEntry.href=location.pathname.startsWith('/showcase/')?'/#new':'http://127.0.0.1:4181/#new';
    operatorEntry.hidden=false;
  }
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => value === null ? '不适用' : Number(value).toLocaleString('en-US');
  const state = { strategy:'low', snapshot:'F', trace:'parameters' };
  const descriptions = {
    D: [
      ['雨夜，独自行走','女孩撑伞走在校园，建立人物与环境。','walk'],
      ['陌生短信','手机特写，展示短信与查看反应。','phone'],
      ['惊讶的表情','面部特写，强调收到短信后的情绪。','face'],
      ['望远，然后离开','女孩望向远处、转身快走，摄影机跟随。','leave'],
    ],
    baseline: [
      ['雨夜，独自行走','保留行走画面，增加语音与时序约束。','walk'],
      ['陌生短信','同样的手机特写，从 6 秒缩短到 4 秒。','phone'],
      ['惊讶的表情','保留表情反应及对白。','face'],
      ['结尾变成空景','没有可见人物，主要靠旁白和脚步暗示离开。','empty','lost','关键人物动作缺失'],
    ],
    low: [
      ['雨夜，独自行走','保留人物、雨伞和校园环境。','walk'],
      ['陌生短信','保留短信特写，时长为 4 秒。','phone'],
      ['惊讶 → 望远 → 离开','合并原第 3、4 镜。人物动作保留，编排更紧凑。','leave','changed','两镜合并 · 关键动作保留'],
    ],
  };
  function illustration(kind) {
    const rain = Array.from({length:12},(_,i)=>`<path d="M${i*12+3} 4l-5 14 M${i*12+10} 53l-5 12"/>`).join('');
    const woman = `<circle cx="69" cy="43" r="5" fill="#a5b8aa"/><path d="m66 49-7 26h17l-4-26M64 75l-5 17M71 75l6 16" stroke="#b8c4b0" stroke-width="3" fill="#789483"/><path d="M49 35q20-24 40 0Z" fill="#71958c" opacity=".8"/><path d="M69 35v27" stroke="#d0d7ba"/>`;
    let subject = woman;
    if(kind==='phone') subject=`<path d="m34 94 22-36 40 9 16 30" fill="#455c50"/><g transform="rotate(10 70 58)"><rect x="49" y="24" width="40" height="65" rx="5" fill="#90a899"/><rect x="53" y="31" width="32" height="48" rx="2" fill="#cedcc1"/><path d="M59 43h20M59 49h16M59 55h18" stroke="#6d8b70" stroke-width="2"/><circle cx="69" cy="84" r="2" fill="#476958"/></g>`;
    if(kind==='face') subject=`<ellipse cx="70" cy="45" rx="24" ry="33" fill="#57766a"/><path d="M50 35q17-18 38 2l-4 31q-16 24-31-1Z" fill="#a4b7a2"/><path d="m55 45 10-1m9 1 10 2" stroke="#354b40" stroke-width="2"/><circle cx="61" cy="48" r="2" fill="#263b32"/><circle cx="78" cy="49" r="2" fill="#263b32"/><path d="M66 67q6-3 10 0" stroke="#476454" fill="none"/><path d="m46 100 10-21 26-2 15 23" fill="#718a75"/>`;
    if(kind==='empty') subject=`<path d="m20 88 38-24 26 0 43 24" stroke="#a1ad87" opacity=".4" fill="none"/><text x="70" y="45" text-anchor="middle" fill="#b5c5a7" font-size="8" letter-spacing="2">NO PERSON</text>`;
    if(kind==='leave') subject=`<g transform="translate(13 7) scale(.85)">${woman}</g><path d="M98 65h17m-4-4 4 4-4 4" fill="none" stroke="#c9da97" stroke-width="1.5"/>`;
    return `<svg viewBox="0 0 140 105" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="140" height="105" fill="#263e39"/><path d="M0 65 43 57 85 59 140 49v56H0" fill="#38534a"/><path d="M0 18h27v44H0M110 9h30v49h-30" fill="#344d43"/><path d="M13 25v27M120 19v26" stroke="#70806a" stroke-width="5"/><path d="m35 105 28-43h20l35 43" fill="#526956" opacity=".5"/><g stroke="#c6d5b2" stroke-width="1" opacity=".18">${rain}</g>${subject}</svg>`;
  }
  function renderShots(snapshot, key) {
    if(!snapshot) return '<div class="no-snapshot">没有修订稿 R<br><small>此离线对照跳过 Review，D 直接经过原 Final。</small></div>';
    const editorial=descriptions[key] || descriptions.D;
    return snapshot.shots.map((s,i)=> {
      const [title,description,kind,style='',flag='']=editorial[i];
      return `<article class="shot-card ${style}"><div class="shot-visual">${illustration(kind)}<span class="shot-number">SHOT ${String(i+1).padStart(2,'0')}</span><span class="shot-time">${s.durationSec}s</span></div><div class="shot-copy"><h4>${title}</h4><p>${description}</p>${flag?`<span class="shot-flag">↳ ${flag}</span>`:''}<details><summary>查看记录原文</summary><p><b>Summary</b><br>${escape(s.summary)}</p><p><b>Camera</b><br>${escape(s.camera)}</p><p><b>Dialogue</b><br>${s.dialogue.map(d=>escape(d.line)).join('<br>') || '无对白'}</p></details></div></article>`;
    }).join('');
  }
  function pipeline() {
    const skip=state.strategy==='skip',base=state.strategy==='baseline';
    const steps=[['D','冻结初稿','同一份输入',''],['GT',base?'绕过策略':skip?'人工跳过':'GreenToken',base?'Baseline':skip?'离线对照':'effort = low',base?'disabled':'active'],[skip?'—':'R',skip?'不执行 Review':'DeepSeek',skip?'0 次请求':'1 次请求',skip?'disabled':''],['✓','原 Final','规则不变',''],['F','审计结果','完整留存','active']];
    $('pipeline').innerHTML=steps.map(([icon,title,sub,cls])=>`<div class="pipeline-node ${cls}"><div class="node-box">${icon}</div><span>${title}</span><small>${sub}</small></div>`).join('<span class="pipeline-arrow">›</span>');
    $('path-tag').textContent=base?'BASELINE / BYPASS':skip?'OFFLINE / SKIP':'OPTIMIZED / LOW';
    $('flow-headline').textContent=base?'原始请求直达模型，保留完整记录。':skip?'不调用 Review，初稿直接进入 Final。':'只改一个参数，保留完整证据链。';
    $('flow-footer').textContent=skip?'人工离线对照 · 不是自动跳过':'Generation 未重新执行 · 无重试';
  }
  function metrics() {
    const r=data.runs[state.strategy],m=r.metrics;
    const cells=[['Total Tokens',number(m.total_tokens),''],['其中 Reasoning',number(m.reasoning_tokens),''],['Output Tokens',number(m.output_tokens),''],['参考费用','$'+m.reference_cost_usd.toFixed(5),'USD'],['模型等待',m.latency_ms===null?'不适用':(m.latency_ms/1000).toFixed(1),m.latency_ms===null?'':'秒']];
    $('metric-strip').innerHTML=cells.map(([label,value,unit])=>`<div class="metric-item"><span>${label}</span><b>${value}</b><small>${unit}</small></div>`).join('');
    const reduction=100*(1-m.total_tokens/data.runs.baseline.metrics.total_tokens);
    $('impact-value').innerHTML=state.strategy==='baseline'?'15,691':`−${state.strategy==='skip'?'100':reduction.toFixed(1)}<span>%</span>`;
    $('impact-description').textContent=state.strategy==='skip'?'Review 增量 Token':state.strategy==='baseline'?'Total Tokens':'本次 Total Tokens';
    $('impact-label').textContent=state.strategy==='baseline'?'原始参照':'vs. Baseline';
    $('impact-caption').textContent=state.strategy==='skip'?'没有调用产生的增量为零；Generation 成本不在此范围。':'一次历史对照的观察值，不代表普遍节省比例。';
    $('metric-bars').innerHTML=['baseline','low','skip'].map(k=>`<div class="metric-bar"><span>${k==='low'?'low':k==='skip'?'Skip':'Baseline'}</span><div class="bar-track"><div class="bar-fill ${k}" style="width:${data.runs[k].metrics.total_tokens/15691*100}%"></div></div><b>${number(data.runs[k].metrics.total_tokens)}</b></div>`).join('');
  }
  function storyboard() {
    const run=data.runs[state.strategy],snap=run.snapshots[state.snapshot];
    $('result-title').innerHTML=`${state.strategy==='skip'?'Skip':state.strategy==='baseline'?'Baseline':'low'} <span>${state.snapshot}</span>`;
    $('result-duration').textContent=snap?`${snap.shots.length} 镜头 · ${snap.duration} 秒`:'未产生 R';
    $('result-shots').innerHTML=renderShots(snap,state.strategy);
    const verdicts={baseline:['!','更短了，但关键动作丢了。','4 镜 / 18 秒。结尾改为空景，未明确展示女孩快步离开。AI 建议 15/28；不能因为 JSON 合法就认为内容合格。'],low:['↗','动作保住了，镜头也更紧凑了。','3 镜 / 16 秒。惊讶与离场合并进最后 8 秒；比 Baseline 完整，但编排更密。AI 建议 19/28，仍有声音指令冲突与原剧本外扩写。'],skip:['＝','少一次改写，保留原稿的完整表达。','4 镜 / 22 秒。实际经过原 Final，输出与 D 相同。AI 建议 20/28；跳过没有修好初稿已有的问题，也不代表所有任务都能跳过。']};
    const [icon,title,body]=verdicts[state.strategy];
    $('content-verdict').innerHTML=`<b>${icon}</b><div><h4>${title}</h4><p>${body}</p></div>`;
  }
  function trace() {
    const r=data.runs[state.strategy],skip=state.strategy==='skip';
    $('trace-label').textContent=r.label.toUpperCase()+' / '+(skip?'OFFLINE':'REVIEW');
    $('trace-status').textContent=skip?'无 API 请求':'HTTP '+r.httpStatus;
    const rows=[['冻结 D 一致','已核验 SHA-256'],['Generation','未重新执行'],['模型请求',skip?'未执行':'成功 · 无重试'],['JSON / 结构',skip?'无需响应解析':'解析成功 / valid'],['Final 来源',skip?'D → Final':'R 已采纳 → Final'],['Python 分析',skip?'离线对照记录':'导入成功 · 不写旧数据库']];
    $('trace-stages').innerHTML=rows.map(([a,b])=>`<div class="trace-stage"><span>${a}</span><b>${b}</b></div>`).join('');
    $('trace-id').innerHTML=skip?'无 call_id · 不伪造调用记录':`CALL ID<br>${escape(r.callId)}<br>${escape(r.startedAt)}（UTC）`;
    let object;
    if(state.trace==='parameters')object=skip?{review_executed:false,generation_executed:false,source:'frozen_D',final_processing:'original'}:r.parameters;
    if(state.trace==='usage')object=skip?{raw_usage:null,review_incremental_tokens:0,reference_cost_usd:0,model_latency_ms:null}:r.usage;
    if(state.trace==='hashes')object={D:data.draft.hash,R:r.snapshots.R?.hash??null,F:r.snapshots.F.hash,prompt:data.hashes.prompt,schema:data.hashes.schema,record:r.recordHash};
    $('trace-json').textContent=JSON.stringify(object,null,2);
    $('trace-note').textContent=state.trace==='parameters'?(skip?'离线 Final 对照；没有模型参数。':'仅显示非敏感参数。temperature 在 Thinking 模式不生效；输出预算未显式设置。'):state.trace==='usage'?'Reasoning 包含在输出 Token 中，不重复计费；未产生的响应字段保留 null。':'D/R/F 使用规范化 JSON 哈希；Prompt / Schema 哈希用于同源核验。';
  }
  function selectStrategy(value) {
    state.strategy=value;
    document.querySelectorAll('[data-strategy]').forEach(b=>{const on=b.dataset.strategy===value;b.setAttribute('aria-pressed',String(on));b.classList.toggle('selected',on);b.classList.toggle('active',on);});
    pipeline();metrics();storyboard();trace();
  }
  document.querySelectorAll('[data-strategy]').forEach(b=>b.addEventListener('click',()=>selectStrategy(b.dataset.strategy)));
  document.querySelectorAll('[data-snapshot]').forEach(b=>b.addEventListener('click',()=>{state.snapshot=b.dataset.snapshot;document.querySelectorAll('[data-snapshot]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-pressed',String(t===b));});storyboard();}));
  document.querySelectorAll('[data-trace]').forEach(b=>b.addEventListener('click',()=>{state.trace=b.dataset.trace;document.querySelectorAll('[data-trace]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-pressed',String(t===b));});trace();}));
  $('original-script').textContent=data.script;
  $('draft-shots').innerHTML=renderShots(data.draft,'D');
  const dimensions=['关键情节与对白','人物动作与行为','镜头主体及表达','场景与道具连续性','时长与结构约束','veoPrompt 可执行性','不必要的新信息'];
  $('quality-table').innerHTML=data.quality.map((q,i)=>`<tr><td title="${escape(q.evidence)}">${dimensions[i]}</td>${[q.D,q.baseline_F,q.optimized_F].map(v=>`<td class="${v<3?'score-low':''}">${v}</td>`).join('')}</tr>`).join('')+'<tr class="total-row"><td>总分 / 28 · 均未判为质量合格</td><td>20</td><td>15</td><td>19</td></tr>';
  const observerResults={
    clean:['建议保留审核','结构完整不等于质量已确认：没有匹配的人工批准，不能自动建议跳过。'],
    approved:['建议跳过（仅测试）','合成案例与模拟批准精确匹配。真实白名单仍为空，没有自动执行跳过。'],
    duration:['建议保留审核','单镜头超出允许时长。本地规则直接否决，即使已有精确模拟批准。'],
    changed:['建议保留审核','内容变化使哈希不匹配，旧批准失效。不是系统自动理解了动作遗漏。'],
    wrong:['错误地建议跳过','已知边界：剧情顺序错误，但被模拟人工误批准。当前规则无法纠正该语义误判。'],
  };
  function observer(){const [title,body]=observerResults[$('observer-case').value];$('observer-result').innerHTML=`<b>${title}</b><p>${body}</p>`;}
  $('observer-case').addEventListener('change',observer);observer();
  $('download-run').addEventListener('click',()=>{const object={dataset_version:data.version,mode:data.mode,comparison:data.comparison,price_version:data.priceVersion,run:data.runs[state.strategy],hashes:data.hashes,quality_assessment:'AI_advisory_not_human_verified'};const url=URL.createObjectURL(new Blob([JSON.stringify(object,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='greentoken-'+state.strategy+'-record.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const sections=[...document.querySelectorAll('main>section')];
  const nav=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+entry.target.id));},{rootMargin:'-15% 0px -65% 0px'});sections.forEach(s=>nav.observe(s));
  const tourSteps=[
    ['overview','low','同一个任务，三种执行策略','展示真实历史记录，所有切换均为本地回放，不调用模型。'],
    ['overview','baseline','先看原始 Review','15,691 Tokens，等待约 143 秒。Baseline 绕过策略，保留原始配置。'],
    ['overview','low','GreenToken 只改一个参数','reasoning_effort=low。此次 Total Tokens 下降 39.8%，等待约 97 秒。'],
    ['storyboard','baseline','节省之前，先看内容','Baseline 结尾变成空景。切换 low 能看到关键人物动作被保留。'],
    ['storyboard','low','同样的故事，不同的修改','low 保留了望远、转身与快步离开，但最后一镜更紧凑，质量仍待人工确认。'],
    ['storyboard','skip','有些调用，也许可以不发生','同一份 D 直接经过 Final，内容未变。它更省，但没有修好初稿的问题。'],
    ['trace','low','每个数字都有证据','请求参数、原始 usage、D/R/F 哈希可追溯。失败记录与实验限制同样保留。'],
    ['observer','low','下一步：判断 Review 是否必要','当前仅观察模式；误批准仍可能漏放，不能把哈希一致当成内容正确。'],
  ];
  let step=0,timer=null,paused=false;
  function schedule(){clearTimeout(timer);if(!paused)timer=setTimeout(()=>{if(step<tourSteps.length-1){step++;showStep();}else stopTour();},9000);}
  function showStep(){const [section,strategy,title,copy]=tourSteps[step];selectStrategy(strategy);$('tour-number').textContent=`${String(step+1).padStart(2,'0')} / ${String(tourSteps.length).padStart(2,'0')}`;$('tour-title').textContent=title;$('tour-copy').textContent=copy;$('tour-progress').style.width=((step+1)/tourSteps.length*100)+'%';$('tour-prev').disabled=step===0;$('tour-next').disabled=step===tourSteps.length-1;$(section).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});schedule();}
  function stopTour(){clearTimeout(timer);$('tour').hidden=true;document.body.classList.remove('tour-running');$('start-tour').textContent='▷ 重新播放项目演示';}
  $('start-tour').addEventListener('click',()=>{step=0;paused=false;$('tour').hidden=false;document.body.classList.add('tour-running');$('tour-pause').textContent='Ⅱ';$('tour-pause').setAttribute('aria-label','暂停演示');showStep();});
  $('tour-prev').addEventListener('click',()=>{if(step>0){step--;showStep();}});
  $('tour-next').addEventListener('click',()=>{if(step<tourSteps.length-1){step++;showStep();}});
  $('tour-pause').addEventListener('click',()=>{paused=!paused;$('tour-pause').textContent=paused?'▷':'Ⅱ';$('tour-pause').setAttribute('aria-label',paused?'继续演示':'暂停演示');schedule();});
  $('tour-close').addEventListener('click',stopTour);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('tour').hidden)stopTour();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!$('tour').hidden&&!paused){paused=true;clearTimeout(timer);$('tour-pause').textContent='▷';$('tour-pause').setAttribute('aria-label','继续演示');}});
  selectStrategy('low');
})();
