'use strict';
function showComparison(root,data) {
  const make=(tag,text,cls)=>{const node=document.createElement(tag);node.textContent=text??'';if(cls)node.className=cls;return node;};
  const labels={baseline:'Baseline',low:'low',skip:'跳过 Review'};
  const offline=data.mode==='offline';
  const cost=v=>v==null?'用量未知':'$'+v.toFixed(5);
  function resources(m) {
    if(!m) return '0 次模型调用 · 0 Token · $0';
    if (offline) return '离线模拟响应 · 真实请求 0 次';
    return [m.requests+' 次请求',(m.total??'未知')+' Token','其中推理 '+(m.reasoning??'未知'),cost(m.cost),
      m.ms==null?'耗时未知':(m.ms/1000).toFixed(1)+' 秒'].join(' · ');
  }
  let focus='all';
  function shots(title,board) {
    const panel=make('section','','board');
    panel.append(make('h3',title));
    if(!board){panel.append(make('p','无此快照'));return panel;}
    panel.append(make('small',board.shots.length+' 镜 · '+board.duration+' 秒'));
    const visible=focus==='last'?board.shots.slice(-1):focus==='all'?board.shots:board.shots.filter(s=>s.index===Number(focus));
    if(!visible.length)panel.append(make('p','这一版没有该序号的镜头。'));
    for(const s of visible) {
      const item=make('article','', 'shot');
      item.append(make('small','镜 '+s.index+'  /  '+s.duration+' 秒'),make('p',s.summary));
      const details=make('details');details.append(make('summary','镜头指令与对白'),make('p',s.prompt),
        make('p','运镜 · '+(s.camera??'—')),make('p','对白 · '+(s.dialogue.map(d=>d.speaker+'：'+d.line).join(' / ')||'无')),make('p','字幕 · '+(s.subtitle||'无')));
      item.append(details);panel.append(item);
    }
    return panel;
  }
  root.replaceChildren();
  root.append(make('strong',offline?'离线演练 · 构造的模拟分镜':data.mode==='historical'?'雨夜校园 · 历史真实 Review':'真实 DeepSeek 实验 · 已保存记录','badge'),
    make('h2','原剧本'),make('blockquote',data.script),make('p',data.generation?'共同生成成本 · '+resources(data.generation):'使用历史冻结初稿，生成用量未收录。'),
    make('small','冻结 D  /  '+data.frozen),make('h2','Review 结果'));
  const controls=make('div','','choices'),grid=make('div','','compare');
  const scroll=make('div','','stats-scroll'),note=make('small','','metrics-note');
  root.append(controls,scroll,note,grid);
  const entries=Object.entries(data.runs), selected=new Set(entries.map(([name])=>name));
  function draw(){
    const table=make('table','','stats'),head=table.createTHead().insertRow();
    for(const label of ['策略','输入 Token','输出 Token','其中推理','总 Token','较 Baseline','参考费用 USD','模型耗时','最终分镜']){
      const th=make('th',label);th.scope='col';head.append(th);
    }
    const rows=table.createTBody();
    const reference=data.runs.baseline?.metrics?.total;
    for(const [name,r] of entries){
      if(!selected.has(name))continue;
      const m=r.metrics,skip=name==='skip';
      const total=m?.total??(skip?0:null);
      const delta=typeof reference==='number' && reference>0 && total!=null?(total-reference)/reference*100:null;
      const format=value=>value==null?'—':value.toLocaleString('en-US');
      const row=rows.insertRow();row.dataset.name=name;
      const th=make('th',labels[name]);th.scope='row';row.append(th);
      for(const value of [format(m?.input??(skip?0:null)),format(m?.output??(skip?0:null)),format(m?.reasoning),
        format(total),name==='baseline'?'基准':delta==null?'—':(delta>0?'+':'')+delta.toFixed(1)+'%',
        skip?'$0':m?.cost==null?'—':cost(m.cost),m?.ms!=null&&!offline?(m.ms/1000).toFixed(1)+' 秒':'—',
        r.F?r.F.shots.length+' 镜 / '+r.F.duration+' 秒':'—'])row.insertCell().textContent=value;
    }
    scroll.replaceChildren(table);
    note.textContent=entries.length?'统计 Review 新增消耗。推理已计入输出，费用按冻结价格估算。— 表示无数据或不适用。':'选择并运行策略后，本表会显示各组用量。';
    grid.replaceChildren(shots('初稿 D',data.D));
    for (const [name,r] of entries) {
      if(!selected.has(name)) continue;
      const col=shots(labels[name]+' · 最终稿 F',r.F);
      const meta=make('p',resources(r.metrics),'info');
      col.children[0].after(meta);
      meta.after(make('small',r.failure?'异常 · '+r.failure+' / Final 来源 '+(r.finalSource??'无'):r.adopted?'采用修订稿 R':'初稿进入 Final'));
      if(r.R) {const detail=make('details');detail.append(make('summary','查看修订稿 R'),shots('Review 快照',r.R));col.append(detail);}
      if(r.metrics) {const detail=make('details');detail.append(make('summary','调用记录'),make('pre',JSON.stringify(r.metrics,null,2)));col.append(detail);}
      grid.append(col);
    }
  }
  for (const [name] of entries) {
    const label=make('label'),box=make('input');box.type='checkbox';box.checked=true;
    box.onchange=()=>{if(box.checked)selected.add(name);else selected.delete(name);draw();};
    label.append(box,document.createTextNode(labels[name]));controls.append(label);
  }
  const focusLabel=make('label','定位镜头 ');
  const picker=make('select');
  picker.add(new Option('全部分镜','all'));
  picker.add(new Option('各版末镜','last'));
  const indexes=new Set([data.D,...entries.map(([,run])=>run.F)].flatMap(board=>(board?.shots??[]).map(shot=>shot.index)));
  for(const index of [...indexes].sort((a,b)=>a-b))picker.add(new Option('镜 '+index,String(index)));
  picker.onchange=()=>{focus=picker.value;draw();};
  focusLabel.append(picker);
  controls.append(focusLabel);
  draw();
}
const replayData=document.getElementById('replay-data');
if(replayData)showComparison(document.getElementById('comparison'),JSON.parse(replayData.textContent));

