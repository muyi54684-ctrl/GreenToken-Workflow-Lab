// Dependency-free, loopback-only static preview. Never serves the integration workspace.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const allowed=new Map(['index.html','style.css','app.js','data.js','evidence.json','mark.svg','README.md'].map(n=>[n,new URL(n,import.meta.url)]));
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',json:'application/json; charset=utf-8',svg:'image/svg+xml',md:'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const pathname=new URL(req.url,'http://localhost').pathname;
  const name=pathname==='/'?'index.html':pathname.slice(1);
  if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
  try{const body=await readFile(allowed.get(name));res.writeHead(200,{'Content-Type':types[name.split('.').pop()],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(500);res.end('Preview file unavailable');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port 4178 is in use. Close the existing preview or use index.html directly.':error.code);process.exitCode=1;});
server.listen(4178,'127.0.0.1',()=>console.log('GreenToken local replay: http://127.0.0.1:4178 (no model calls)'));
