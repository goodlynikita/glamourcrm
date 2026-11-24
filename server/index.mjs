import {createServer} from 'node:http';
import {createHash,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createReadStream} from 'node:fs';
import {stat,readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyCommand,byPerson,seed,today,upgradeState} from '../dist/model.mjs';
import {commandFor,RequestError,visibleState} from './access.mjs';

const demo=process.argv.includes('--demo');
const host=process.env.GLAMOUR_HOST||'127.0.0.1';
const port=Number(process.env.PORT||8787);
const secure=process.env.GLAMOUR_HTTPS==='1';
const storage=resolve(process.env.GLAMOUR_DB||'data/glamour.sqlite');
if(demo&&!['127.0.0.1','::1','localhost'].includes(host))throw Error('Демонстрационный сервер должен слушать localhost.');
if(!demo&&!secure&&!['127.0.0.1','::1','localhost'].includes(host))throw Error('Для сетевого доступа нужен HTTPS и GLAMOUR_HTTPS=1.');
if(!Number.isInteger(port)||port<0||port>65535)throw Error('Проверьте PORT.');

const configured=demo?{manager:'glamour-demo',alina:'glamour-demo',maria:'glamour-demo',sofia:'glamour-demo'}:
  JSON.parse(process.env.GLAMOUR_USERS_JSON||'{}');
if(!Object.hasOwn(configured,'manager'))throw Error('Задайте пароль manager в GLAMOUR_USERS_JSON или запустите с --demo.');
const credentials=new Map();
const sample=seed(today(),true);
for(const [id,password] of Object.entries(configured)){
  if(!byPerson(id,sample)||typeof password!=='string'||password.length<(demo?10:12)||password.length>256)throw Error('Проверьте пользователей и пароли в GLAMOUR_USERS_JSON.');
  const salt=randomBytes(16);
  credentials.set(id,{salt,hash:scryptSync(password,salt,64)});
}
const unknown={salt:randomBytes(16),hash:randomBytes(64)};
const sessionAge=8*60*60*1000;
const cookieName=secure?'__Host-glamour':'glamour';
const requestLimit=22*1024*1024;
const attempts=new Map();
const attemptWindow=15*60*1000;
const fileRoot=fileURLToPath(new URL('../dist/',import.meta.url));
const html=(await readFile(resolve(fileRoot,'index.html'),'utf8')).replace('</head>',
  '<meta name="glamour-runtime" content="'+(demo?'demo-server':'server')+'">\n</head>');

await mkdir(dirname(storage),{recursive:true,mode:0o700});
const db=new DatabaseSync(storage);
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)");
const getState=db.prepare('SELECT body FROM snapshot WHERE id=1');
const putState=db.prepare('INSERT INTO snapshot(id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body');
const getSession=db.prepare('SELECT user_id,expires FROM sessions WHERE token=?');
const addSession=db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)');
const deleteSession=db.prepare('DELETE FROM sessions WHERE token=?');
const purgeSessions=db.prepare('DELETE FROM sessions WHERE expires<=?');
if(!getState.get())putState.run(JSON.stringify(seed(today(),!demo)));
if(process.platform!=='win32'){
  const {chmod}=await import('node:fs/promises');
  await chmod(storage,0o600);
}
const state=()=>upgradeState(JSON.parse(getState.get().body));
const hash=token=>createHash('sha256').update(token).digest('hex');
const tokenFor=req=>{
  const raw=(req.headers.cookie||'').split(';').map(piece=>piece.trim()).find(piece=>piece.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  return raw&&/^[A-Za-z0-9_-]{43}$/.test(raw)?hash(raw):'';
};
const identity=req=>{
  const token=tokenFor(req);
  const hit=token?getSession.get(token):null;
  return hit&&hit.expires>Date.now()&&credentials.has(hit.user_id)?hit.user_id:null;
};
function cookie(value,age){
  return cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(secure?'; Secure':'');
}
function json(res,status,value){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}
async function body(req,limit=requestLimit){
  if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new RequestError(415,'Нужен JSON.');
  if(Number(req.headers['content-length'])>limit)throw new RequestError(413,'Слишком большой запрос.');
  let length=0;
  const chunks=[];
  for await(const chunk of req){
    length+=chunk.length;
    if(length>limit)throw new RequestError(413,'Слишком большой запрос.');
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw new RequestError(400,'Неверный JSON.');}
}
function sameOrigin(req){
  let valid=false;
  try{valid=new URL(req.headers.origin).origin===(secure?'https://':'http://')+req.headers.host;}catch{}
  if(!valid)throw new RequestError(403,'Запрос пришёл с другого сайта.');
}
function loginLimit(req){
  const now=Date.now();
  for(const [key,item] of attempts)if(item.until<=now)attempts.delete(key);
  const key=req.socket.remoteAddress;
  const item=attempts.get(key)??{count:0,until:now+attemptWindow};
  if(item.count>=15)throw new RequestError(429,'Слишком много попыток входа. Повторите через 15 минут.');
  item.count++;
  attempts.set(key,item);
  return key;
}
async function api(req,res,url){
  if(url.pathname==='/api/session'&&req.method==='GET'){
    const id=identity(req);
    return json(res,200,{user:id?byPerson(id,state()):null,demo});
  }
  if(req.method==='POST')sameOrigin(req);
  if(url.pathname==='/api/login'&&req.method==='POST'){
    const key=loginLimit(req);
    const input=await body(req,3072);
    const user=typeof input?.user==='string'?input.user.trim():'';
    const password=typeof input?.password==='string'?input.password:'';
    if(password.length>256||user.length>120)throw new RequestError(400,'Проверьте логин и пароль.');
    const expected=credentials.get(user)??unknown;
    const matches=timingSafeEqual(scryptSync(password,expected.salt,64),expected.hash);
    if(!matches||expected===unknown)throw new RequestError(401,'Неверный логин или пароль.');
    attempts.delete(key);
    purgeSessions.run(Date.now());
    const previous=tokenFor(req);
    if(previous)deleteSession.run(previous);
    const token=randomBytes(32).toString('base64url');
    addSession.run(hash(token),user,Date.now()+sessionAge);
    res.setHeader('Set-Cookie',cookie(token,sessionAge/1000));
    return json(res,200,{user:byPerson(user,state()),demo});
  }
  const id=identity(req);
  if(!id)throw new RequestError(401,'Войдите в систему.');
  if(url.pathname==='/api/logout'&&req.method==='POST'){
    deleteSession.run(tokenFor(req));
    res.setHeader('Set-Cookie',cookie('',0));
    return json(res,200,{});
  }
  if(url.pathname==='/api/state'&&req.method==='GET'){
    const snapshot=state();
    return json(res,200,visibleState(snapshot,byPerson(id,snapshot)));
  }
  if(url.pathname==='/api/commands'&&req.method==='POST'){
    const input=await body(req);
    db.exec('BEGIN IMMEDIATE');
    try{
      const original=state();
      const command=commandFor(original,input,id,{demo});
      let result;
      try{result=applyCommand(original,command);}
      catch(error){throw new RequestError(422,error instanceof TypeError?'Проверьте поля запроса.':error.message);}
      const view=visibleState(result.next,byPerson(id,result.next));
      putState.run(JSON.stringify(result.next));
      db.exec('COMMIT');
      return json(res,200,{state:view,value:result.value});
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  throw new RequestError(404,'Метод не найден.');
}

const contentTypes={'.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.txt':'text/plain; charset=utf-8','.html':'text/html; charset=utf-8'};
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    if(req.method!=='GET'&&req.method!=='HEAD')throw new RequestError(405,'Метод не разрешён.');
    if(url.pathname==='/'||url.pathname==='/index.html'){
      res.writeHead(200,{'Content-Type':contentTypes['.html'],'Cache-Control':'no-store'});
      return res.end(req.method==='HEAD'?undefined:html);
    }
    const file=resolve(fileRoot,'.'+decodeURIComponent(url.pathname));
    const contentType=contentTypes[extname(file)];
    if(!file.startsWith(resolve(fileRoot)+sep)||!contentType)throw new RequestError(404,'Файл не найден.');
    const info=await stat(file).catch(()=>null);
    if(!info?.isFile())throw new RequestError(404,'Файл не найден.');
    res.writeHead(200,{'Content-Type':contentType,'Content-Length':info.size,'Cache-Control':'no-cache'});
    if(req.method==='HEAD')return res.end();
    createReadStream(file).pipe(res);
  }catch(error){
    if(res.headersSent){res.end();return;}
    const status=error instanceof RequestError?error.status:500;
    if(status===500)console.error(error.name);
    json(res,status,{error:status===500?'Непредвиденная ошибка сервера.':error.message});
  }
});
function scheduleAgent(){
  let started=false;
  try{
    db.exec('BEGIN IMMEDIATE');
    started=true;
    const snapshot=state();
    if(snapshot.agent.auto){
      const {next,value}=applyCommand(snapshot,{type:'agent-cycle'});
      if(value.assigned)putState.run(JSON.stringify(next));
    }
    db.exec('COMMIT');
  }catch(error){
    if(started)db.exec('ROLLBACK');
    console.error('Агент: '+error.name);
  }
}
scheduleAgent();
setInterval(scheduleAgent,15*60*1000).unref();
server.listen(port,host,()=>console.log('GLAMOUR CRM · http://'+host+':'+server.address().port+(demo?' · демо':'')));
