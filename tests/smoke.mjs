import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {demoCsv,parseCsv,previewRows,readFile} from '../dist/importer.mjs';
import {applyCommand,retentionReason,retentionReport,seed,settingsFor,shiftDate,today} from '../dist/model.mjs';

const day=today();
const date=offset=>shiftDate(day,offset);
const fixture=[
  {name:'Сима Листова',phone:'70000001101',externalId:'test-a',branch:'center',lastVisit:date(-100),visitCount:1},
  {name:'Мира Облачная',phone:'70000001102',externalId:'test-b',branch:'north',lastVisit:date(-99),visitCount:7,nextBooking:date(5)},
  {name:'Рада Медовая',phone:'70000001103',externalId:'test-c',branch:'south',lastCancellation:date(-8),cancelCount:2},
  {name:'Ева Летняя',phone:'70000001104',externalId:'test-d',branch:'center',registered:date(-300)}
];

test('CSV and Excel mapping preserve unknown fields and check repeat imports',async()=>{
  const empty=seed(day,true);
  const csv=previewRows(parseCsv(demoCsv()),empty.clients,'center',{demoOnly:true});
  assert.equal(csv.added,4);
  assert.deepEqual(csv.issues,[]);
  const manual=previewRows(parseCsv('Карточка;Тел;Код\nАлла Звёздная;+70000000125;case-25'),[],'center',
    {mapping:{name:0,phone:1,externalId:2},demoOnly:true});
  assert.equal(manual.added,1);
  assert(!Object.hasOwn(manual.records[0],'lastVisit'));
  const require=createRequire(import.meta.url);
  const XLSX=require('../dist/assets/xlsx.full.min.js');
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['Имя клиента','ID клиента','Филиал','Количество визитов','Последний визит'],
    ['Лина Летняя','lina-1','Север',1,45000]
  ]),'Клиенты');
  const excel=await readFile(new File([XLSX.write(workbook,{type:'array',bookType:'xlsx'})],'демо.xlsx'),XLSX);
  const parsed=previewRows(excel.rows,[],'center',excel);
  assert.equal(parsed.records[0].lastVisit,'2023-03-15');
  assert.equal(parsed.records[0].visitCount,1);
  assert.equal(previewRows(excel.rows,[{...parsed.records[0],id:'existing'}],'center',excel).duplicates,1);
  const bad=previewRows(parseCsv('ФИО;Телефон\nТест;+79161234567'),[],'center',{demoOnly:true});
  assert.equal(bad.issues.length,1);
  assert.match(bad.issues[0].reason,/вымышленные/);
  const original=applyCommand(empty,{type:'import-clients',clients:fixture}).next;
  assert.deepEqual(original.clients.map(client=>retentionReason(original,client)),['single','future','cancellation','unknown']);
});

async function startServer(file){
  const child=spawn(process.execPath,['server/index.mjs','--demo'],{cwd:new URL('../',import.meta.url),
    env:{...process.env,PORT:'0',GLAMOUR_DB:file,GLAMOUR_HOST:'127.0.0.1',GLAMOUR_HTTPS:'0'},stdio:['ignore','pipe','pipe']});
  const origin=await new Promise((resolve,reject)=>{
    const stop=setTimeout(()=>{child.kill();reject(Error('Сервер не запустился.'));},8000);
    child.once('error',error=>{clearTimeout(stop);reject(error);});
    child.once('exit',code=>{clearTimeout(stop);reject(Error('Сервер завершился: '+code));});
    let log='';
    child.stdout.on('data',chunk=>{
      log+=chunk;
      const address=log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if(address){clearTimeout(stop);resolve(address[0]);}
    });
  });
  return {child,origin};
}
async function stopServer(child){
  const exit=once(child,'exit');
  child.kill();
  await exit;
}

test('authorized server workflow with branch isolation, retention report, and persisted data',async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'glamour-test-'));
  const dbFile=join(tmp,'test.sqlite');
  let instance=await startServer(dbFile);
  try{
    async function api(path,{session,values,origin=instance.origin}={}){
      const post=values!==undefined;
      const response=await fetch(instance.origin+'/api/'+path,{method:post?'POST':'GET',
        headers:{...(session?{cookie:session}:{}),...(post?{origin,'content-type':'application/json'}:{})},
        body:post?JSON.stringify(values):undefined});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
    }
    const login=async user=>{
      const result=await api('login',{values:{user,password:'glamour-demo'}});
      assert.equal(result.status,200);
      return result.cookie;
    };
    assert.equal((await api('state')).status,401);
    assert.equal((await api('login',{values:{user:'manager',password:'glamour-demo'},origin:'https://other.example'})).status,403);
    const manager=await login('manager');
    const staff=await login('alina');
    const send=(session,values)=>api('commands',{session,values});
    assert.equal((await send(staff,{type:'import-clients',clients:fixture})).status,403);
    const imported=await send(manager,{type:'import-clients',filename:'тест.csv',clients:fixture});
    assert.equal(imported.status,200);
    assert.equal(imported.data.value.added,4);
    const [first,future,cancelled,unknown]=fixture.map(row=>imported.data.state.clients.find(client=>client.externalId===row.externalId));
    assert.equal(unknown.lastVisit,'');
    const adminBefore=(await api('state',{session:staff})).data;
    assert(adminBefore.clients.every(client=>client.branch==='center'));
    assert(!adminBefore.clients.some(client=>client.id===future.id));
    assert.equal((await send(staff,{type:'record-contact',clientId:future.id,values:{assignee:'alina',result:'declined'}})).status,403);
    const assign={type:'assign-outreach',branch:'center',assignee:'alina',due:day,group:'single',count:25};
    const assigned=await send(manager,assign);
    assert.equal(assigned.status,200);
    const task=assigned.data.state.tasks.find(item=>item.clientId===first.id);
    assert.equal(task.reason,'single');
    assert.equal(task.priority,'high');
    assert.equal((await send(manager,assign)).data.value.assigned,0);
    const seen=await send(staff,{type:'record-contact',clientId:first.id,taskId:task.id,
      values:{assignee:'alina',result:'no_answer',followUp:date(1),note:'Демо'}});
    assert.equal(seen.status,200);
    const next=seen.data.state.tasks.find(item=>item.clientId===first.id&&item.status==='new');
    assert.equal(next.reason,'followup');
    assert.equal(next.originReason,'single');
    assert.equal(next.due,date(1));
    const moved=await send(staff,{type:'record-contact',clientId:first.id,taskId:next.id,
      values:{assignee:'alina',result:'callback',followUp:date(2),followUpTime:'14:30',note:''}});
    assert.equal(moved.status,200);
    const callback=moved.data.state.tasks.find(item=>item.clientId===first.id&&item.status==='new');
    assert.equal(callback.dueTime,'14:30');
    const settled=await send(staff,{type:'record-contact',clientId:first.id,taskId:callback.id,values:{assignee:'alina',result:'do_not_contact',note:'Просьба клиента'}});
    assert.equal(settled.status,200);
    assert(settled.data.state.clients.find(item=>item.id===first.id).callBlocked);
    assert.equal((await send(manager,assign)).data.value.assigned,0);
    const refresh=await send(manager,{type:'import-clients',filename:'обновление.csv',clients:[{...fixture[0],name:'Сима Листова-Весенняя'}]});
    assert.equal(refresh.status,200);
    assert.equal(refresh.data.value.updated,1);
    assert.equal(refresh.data.state.clients.find(item=>item.id===first.id).callBlocked,true);
    assert.equal(refresh.data.state.tasks.filter(item=>item.clientId===first.id&&item.result).length,3);
    assert.equal(retentionReport(refresh.data.state,{reason:'single',branch:'center'}).declined,1);
    assert.equal((await send(staff,{type:'reset-demo'})).status,403);
    const wrongAssignment=await send(manager,{...assign,branch:'south'});
    assert.equal(wrongAssignment.status,422);

    const sofia=await login('sofia');
    const southAssignment=await send(manager,{...assign,branch:'south',assignee:'sofia',group:'cancellation'});
    assert.equal(southAssignment.status,200);
    const cancellationTask=southAssignment.data.state.tasks.find(item=>item.clientId===cancelled.id);
    assert.equal(cancellationTask.reason,'cancellation');
    const confirmation=await send(sofia,{type:'record-contact',clientId:cancelled.id,taskId:cancellationTask.id,
      values:{assignee:'sofia',result:'booked',appointment:date(4),visitTime:'11:00',note:''}});
    assert.equal(confirmation.status,200);
    assert.equal(confirmation.data.state.tasks.find(item=>item.id===cancellationTask.id).result,'booked');
    assert.equal(confirmation.data.state.opportunities.find(item=>item.clientId===cancelled.id).planned,null);
    assert.equal(retentionReason(confirmation.data.state,confirmation.data.state.clients.find(item=>item.id===cancelled.id)),'future');
    assert.equal(retentionReport(confirmation.data.state,{reason:'cancellation',branch:'south'}).booked,1);

    const cfg=settingsFor(refresh.data.state);
    const settings={rules:{...cfg.rules,singleDays:50},branches:Object.fromEntries(cfg.branches.map(b=>[b.id,b.name])),
      users:Object.fromEntries(cfg.users.filter(p=>p.branch).map(p=>[p.id,{name:p.name,branches:[p.branch],role:'admin'}])),newBranch:'Кирова'};
    assert.equal((await send(manager,{type:'save-settings',values:settings})).status,200);
    assert.equal((await api('logout',{session:staff,values:{}})).status,200);
    assert.equal((await api('state',{session:staff})).status,401);

    await stopServer(instance.child);
    instance=await startServer(dbFile);
    const reopened=(await api('state',{session:manager})).data;
    assert.equal(reopened.clients.find(item=>item.id===first.id).name,'Сима Листова-Весенняя');
    assert(reopened.clients.some(client=>client.id===cancelled.id));
    assert(reopened.settings.branches.some(branch=>branch.name==='Кирова'));
    const reset=await send(manager,{type:'reset-demo'});
    assert(reset.data.value.reset);
    assert(!reset.data.state.clients.some(client=>client.id===first.id));
  }finally{
    if(instance.child.exitCode===null)await stopServer(instance.child);
    await rm(tmp,{recursive:true,force:true});
  }
});
