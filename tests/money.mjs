import test from 'node:test';
import assert from 'node:assert/strict';
import {moneyAudit} from '../dist/money-audit.mjs';
import {branchMoney,canStartReturn,paymentBuckets,paymentPeriods} from '../dist/work-analytics.mjs';
import {applyCommand,clientHistory,lastKnownVisit,seed,shiftDate,today} from '../dist/model.mjs';
import {parseCsv,previewRows} from '../dist/importer.mjs';
import {analysisInput,askForAnalysis} from '../server/ai.mjs';
import {commandFor,visibleState} from '../server/access.mjs';

const day=today();
const past=shiftDate(day,-100);

test('revenue chart covers each day exactly once and includes today',()=>{
  for(const period of paymentPeriods){
    const outside=[{date:shiftDate(day,-period),amount:9999},{date:shiftDate(day,1),amount:9999}];
    const records=Array.from({length:period},(_,index)=>({date:shiftDate(day,-index),amount:100+index}));
    const buckets=paymentBuckets([...outside,...records],day,period);
    assert.equal(buckets[0].from,shiftDate(day,1-period));
    assert.equal(buckets.at(-1).through,day);
    assert.equal(buckets.reduce((sum,bucket)=>sum+bucket.count,0),period);
    assert.equal(buckets.reduce((sum,bucket)=>sum+bucket.amount,0),records.reduce((sum,entry)=>sum+entry.amount,0));
    assert(buckets.slice(1).every((bucket,index)=>bucket.from===shiftDate(buckets[index].through,1)));
  }
});

test('branch breakdown keeps paid and estimated amounts separate and priority excludes unavailable rows',()=>{
  const branches=[{id:'center'},{id:'north'}];
  const rows=[
    {client:{id:'one',branch:'center'},amount:60000,working:false,contactable:true,paused:false},
    {client:{id:'two',branch:'center'},amount:30000,working:true,contactable:true,paused:false},
    {client:{id:'three',branch:'north'},amount:null,working:false,contactable:true,paused:true},
    {client:{id:'four',branch:'north'},amount:10000,working:false,contactable:false,paused:false}
  ];
  const recorded=[{clientId:'one',amount:38500},{clientId:'three',amount:56000},{clientId:'other',amount:90000}];
  const result=branchMoney({rows,recorded},branches,new Map(rows.map(row=>[row.client.id,row.client.branch])));
  assert.deepEqual(result.map(group=>[group.branch.id,group.amount,group.confirmed,group.count,group.priced]),
    [['center',90000,38500,2,2],['north',10000,56000,2,1]]);
  assert.deepEqual(rows.filter(canStartReturn).map(row=>row.client.id),['one']);
});
const client=(id,fields={})=>({
  id,name:'Демо '+id,branch:'center',service:'Маникюр',lastVisit:past,
  visitCount:2,phone:'70000000101',history:[],...fields
});

test('analyzes one purchase per client using evidence and same-branch estimates, never registration dates',()=>{
  const state=seed(day,true);
  state.clients=[
    client('a',{meanCheck:200000}),client('b',{lastPaid:250000}),client('c',{meanCheck:300000}),
    client('comparable'),client('lifetime',{lifetimePaid:920000,visitCount:4,service:'Дизайн'}),
    client('unknown',{lastVisit:'',registered:past,meanCheck:1200000}),client('other',{branch:'north'}),
    client('future',{nextBooking:shiftDate(day,1),meanCheck:900000,service:'Педикюр'}),
    client('blocked',{callBlocked:true,meanCheck:900000,service:'Педикюр'})
  ];
  const center=moneyAudit(state,{day,branch:'center'});
  const rows=Object.fromEntries(center.rows.map(row=>[row.client.id,row]));
  assert.equal(rows.comparable.amount,250000);
  assert.equal(rows.comparable.basis,'benchmark');
  assert.equal(rows.lifetime.amount,230000);
  assert.equal(center.open,1230000);
  assert.equal(center.unclassified,1);
  assert.equal(center.estimated,1);
  assert(!rows.unknown&&!rows.future&&!rows.blocked&&!rows.other);
  const north=moneyAudit(state,{day,branch:'north'});
  assert.equal(north.unknown,1);
  assert.equal(north.rows[0].amount,null);
});

test('imports amounts in rubles and puts the highest opportunity first after import',()=>{
  const empty=applyCommand(seed(day,true),{type:'agent-settings',auto:true,limit:1}).next;
  const csv=previewRows(parseCsv('Имя клиента;ID клиента;Телефон;Последний визит;Средний чек;Всего оплачено;Количество визитов\n'+
    'Демо А;a;70000001601;'+past+';2 431,50 ₽;;1\n'+
    'Демо Б;b;70000001602;'+past+';;25 000;5\n'+
    'Демо В;c;70000001603;'+past+';ошибка;;1'),[],'center',{demoOnly:true});
  assert.equal(csv.issues.length,1);
  assert.equal(csv.records[0].meanCheck,243150);
  assert.equal(csv.records[1].lifetimePaid,2500000);
  const {next,value}=applyCommand(empty,{type:'import-clients',clients:csv.records});
  assert.equal(value.assigned,1);
  assert.equal(next.tasks[0].clientId,next.clients.find(row=>row.externalId==='b').id);
  const audit=moneyAudit(next,{day});
  assert.equal(audit.open,743150);
  assert.equal(audit.confirmed,0);
  const update=previewRows(parseCsv('Имя клиента;ID клиента;Средний чек\nДемо А;a;'),next.clients,'center');
  assert.equal(update.updated,0);
});

test('a factual payment can close outreach, is idempotent and is isolated by branch',()=>{
  const state=seed(day,true);
  const c=client('a',{meanCheck:400000});
  state.clients=[c,client('b',{branch:'north',lastPaid:100000})];
  const assigned=applyCommand(state,{type:'assign-outreach',branch:'center',assignee:'alina',group:'focus',count:10}).next;
  const {id:taskId}=assigned.tasks[0];
  const command={type:'record-contact',clientId:c.id,taskId,
    values:{result:'paid',assignee:'alina',requestId:'recovery-test-1',paidAmount:'3 590,50',paidDate:day,note:'Оплата подтверждена'}};
  assert.throws(()=>commandFor(assigned,command,'maria'),/закрыт/);
  assert.throws(()=>applyCommand(assigned,{...command,values:{...command.values,paidDate:shiftDate(day,1)}}),/фактическую/);
  const result=applyCommand(assigned,commandFor(assigned,command,'alina')).next;
  const savedAgain=applyCommand(result,command).next;
  assert.equal(savedAgain.recoveries.length,1);
  assert.equal(savedAgain.tasks[0].status,'done');
  assert.equal(moneyAudit(savedAgain,{day,branch:'center'}).confirmed,359050);
  assert.equal(moneyAudit(savedAgain,{day,branch:'center'}).rows.length,0);
  assert.equal(lastKnownVisit(savedAgain,c).lastVisit,past);
  assert.equal(clientHistory(savedAgain,c).filter(event=>event.kind==='payment').length,1);
  assert.equal(visibleState(savedAgain,savedAgain.settings.users.find(p=>p.id==='maria')).recoveries.length,0);
  assert.throws(()=>applyCommand(savedAgain,{...command,taskId:'',values:{...command.values,requestId:'different-id'}}),/уже есть/);
});

test('optional model receives only anonymous aggregates and never changes the calculated amounts',async()=>{
  const state=seed(day,true);
  state.clients=[client('private-id',{phone:'70000009876',meanCheck:250000})];
  const input=analysisInput(state,{day});
  assert.equal(input.returnCandidates,1);
  assert.equal(input.groups[0].shareOfPotential,null);
  const output=await askForAnalysis(input,{key:'mock',request:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization,'Bearer mock');
    const payload=JSON.parse(options.body);
    assert.equal(payload.store,false);
    assert.equal(payload.input.includes('private-id'),false);
    assert.equal(payload.input.includes('70000009876'),false);
    assert.equal(payload.input.includes('250000'),false);
    return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Уточните причину отсутствия.'}]}]})};
  }});
  assert.equal(output,'Уточните причину отсутствия.');
  assert.equal(moneyAudit(state,{day}).open,250000);
});
