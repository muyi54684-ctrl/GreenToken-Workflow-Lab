import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createLab, requireValue} from './engine.mjs';
import {publicReplay,renderReplay,renderPublicReplay} from './replay.mjs';
import {archivedCase} from './archive.mjs';

const assets=new Set(['index.html','style.css','lab.js','viewer.js']);
const types={html:'text/html',css:'text/css',js:'text/javascript'};
export function createServer(lab) {
  return http.createServer(async(req,res)=>{
    function send(code,body,type='application/json',extra={}) {
      res.writeHead(code,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});
      res.end(type==='application/json'?JSON.stringify(body):body);
    }
    try {
      const host='127.0.0.1:'+req.socket.localPort;
      requireValue(req.headers.host===host,'请使用本机预览地址。',403);
      const path=new URL(req.url,'http://'+host).pathname;
      if(req.method==='POST') {
        requireValue(req.headers.origin==='http://'+host && req.headers['content-type']==='application/json','需要从本机实验台操作。',403);
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;requireValue(size<=100000,'剧本过长。',413);chunks.push(chunk);}
        let body;
        try {body=JSON.parse(Buffer.concat(chunks).toString());}catch{requireValue(false,'请求格式有误。');}
        requireValue(body && typeof body==='object'&&!Array.isArray(body),'请求格式有误。');
        let result;
        if(path==='/api/generate')result=await lab.generate(body);
        else if(path==='/api/freeze')result=await lab.freeze(body.id);
        else if(path==='/api/run')result=await lab.run(body.id,body.group,body.confirmation);
        else return send(404,{error:'没有此操作。'});
        return send(200,result);
      }
      if(req.method!=='GET')return send(405,{error:'方法无效。'});
      if(path==='/api/archive/view')return send(200,await archivedCase());
      if(path==='/api/archive/replay')return send(200,await renderPublicReplay(await archivedCase()),'text/html',
        {'Content-Disposition':'attachment; filename="GreenToken-campus.html"'});
      if(path.startsWith('/showcase/')){
        const file=path.slice('/showcase/'.length);
        const mime={'index.html':'text/html','app.js':'text/javascript','data.js':'text/javascript',
          'style.css':'text/css','evidence.json':'application/json','mark.svg':'image/svg+xml','README.md':'text/plain'};
        if(!Object.hasOwn(mime,file))return send(404,{error:'找不到资源。'});
        return send(200,await readFile(new URL('../showcase/'+file,import.meta.url)),mime[file]);
      }
      if(path==='/api/list')return send(200,{mode:lab.mode,items:await lab.list()});
      const match=path.match(/^\/api\/([a-f0-9-]+)(?:\/(view|replay))?$/);
      if(match){
        const e=await lab.get(match[1]);
        if(!match[2])return send(200,e);
        requireValue(e.frozen,'请先冻结初稿。',409);
        if(match[2]==='view')return send(200,publicReplay(e));
        requireValue(Object.values(e.runs).some(r=>r.status!=='reserved'),'请先完成至少一个策略。',409);
        return send(200,await renderReplay(e),'text/html',{'Content-Disposition':'attachment; filename="GreenToken-'+e.mode+'-'+e.id+'.html"'});
      }
      const name=path==='/'?'index.html':path.slice(1);
      if(!assets.has(name))return send(404,{error:'找不到资源。'});
      return send(200,await readFile(new URL(name,import.meta.url)),types[name.split('.').pop()],{
        'Content-Security-Policy':"default-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
    }catch(e){send(e.status??500,{error:e.status?e.message:'操作未完成，请刷新查看已保存的记录。'});}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  requireValue(args.length===0||(args.length===1&&args[0]==='--live'),'启动选项无效。');
  const root=fileURLToPath(new URL('../../.review-experiments/local-lab/',import.meta.url));
  const lab=createLab(root,{live:args.includes('--live')});
  const server=createServer(lab);
  const port=lab.mode==='live'?4181:4180;
  server.on('error',()=>{console.error('无法启动，请检查端口 '+port);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log('GreenToken '+lab.mode+' · http://127.0.0.1:'+port));
}

