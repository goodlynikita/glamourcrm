import test from 'node:test';
import assert from 'node:assert/strict';
import {contactBrief,identifyObjection,recommend} from '../dist/agent.mjs';
import {applyCommand,retentionReason,seed,shiftDate,today} from '../dist/model.mjs';
import {contactGroups,nextContact} from '../dist/contact-desk.mjs';
import {moneyAudit} from '../dist/money-audit.mjs';
import {commandFor,visibleState} from '../server/access.mjs';

const day=today();
const sample=[
  {name:'Тест Один',branch:'center',phone:'70000001991',externalId:'a1',lastVisit:shiftDate(day,-110),visitCount:1},
  {name:'Тест Два',branch:'center',phone:'70000001992',externalId:'a2',lastVisit:shiftDate(day,-88),visitCount:6},
  {name:'Тест Три',branch:'north',phone:'70000001993',externalId:'a3',lastVisit:shiftDate(day,-90),visitCount:1,nextBooking:shiftDate(day,7)},
  {name:'Тест Четыре',branch:'north',phone:'70000001994',externalId:'a4',lastVisit:shiftDate(day,-91),visitCount:1}
];
test('suggestions use branch feedback and honor contact opt-out',()=>{
  assert.equal(identifyObjection('Мне дорого'), 'price');
  assert.equal(identifyObjection('Мне нужно дешевле, дорого'), 'price');
  assert.equal(identifyObjection('Плохо сделали и слишком дорого'), 'quality');
  assert.equal(identifyObjection('Уберите номер, не звоните больше'), 'stop');
  assert.equal(recommend('Не звоните').options[0].outcome,'do_not_contact');
  const old=recommend('Дорого').options[0].id;
  const result=recommend('Дорого',[{branch:'center',option:old,objection:'price',helpful:false}],'center');
  assert.notEqual(result.options[0].id,old);
  assert.equal(recommend('Дорого',[{branch:'center',option:old,objection:'price',helpful:false}],'north').options[0].id,old);
  assert.equal(recommend('Сейчас работаю, перезвоните завтра').options[0].outcome,'callback');
  assert.equal(recommend('Больше не перезванивайте').options[0].outcome,'do_not_contact');
});

test('demo queue opens with a tailored script and varied examples, while imported clients get factual guidance',()=>{
  const state=seed(day);
  const queue=contactGroups(state,{day}).ready;
  const scripts=queue.map(row=>{
    const client=state.clients.find(item=>item.id===row.clientId);
    const script=contactBrief({client,reason:retentionReason(state,client,day),service:client.service});
    assert(script.opening.includes(client.name.split(' ')[0]));
    assert(script.goal&&script.example);
    assert.doesNotMatch(script.opening,/\{[^}]+\}/);
    return identifyObjection(script.example);
  });
  assert(scripts.includes('price')&&scripts.includes('quality')&&scripts.includes('location')&&scripts.includes('provider'));
  const script=contactBrief({client:{id:'c15',name:'Ирина Пример',source:'import'},reason:'unknown'});
  assert.match(script.question,/вы уже бывали у нас/);
  assert.doesNotMatch(script.opening,/Ирина/);
  assert.equal(script.example,null);
  const repeat=contactBrief({client:state.clients[0],reason:'single',previousResult:'no_answer',followUp:true});
  assert.match(repeat.question,/пыталась с вами связаться/);
  assert.equal(recommend(repeat.example).options[0].outcome,'callback');
});

test('scripts match conversational phrases and suggest only a relevant next action',()=>{
  const cases=[
    ['Ушла в другой салон','provider','respect','declined'],
    ['Нашла другого мастера, спасибо','provider','respect','declined'],
    ['Я теперь делаю у подруги','provider','respect','declined'],
    ['Ушла в другую студию, могу рассказать почему','provider','alternative','declined'],
    ['В другом салоне было дешевле, но я хочу записаться к вам','interest','offer','contacted'],
    ['Я не хочу записаться, пока не актуально','not_now','close','declined'],
    ['Бюджет сейчас маленький, для меня дороговато','price','budget','contacted'],
    ['Сколько стоит маникюр?','price','scope','contacted'],
    ['У других дешевле','price','budget','contacted'],
    ['Только вечером, до этого работаю','time','windows','contacted'],
    ['За рулём, перезвоните завтра','time','callback','callback'],
    ['Не звоните сейчас, я за рулём','time','callback','callback'],
    ['Я на встрече, сейчас не могу говорить','time','callback','callback'],
    ['Далеко ехать, нужно рядом с домом','location','branch','contacted'],
    ['Уехала из города','location','one-visit','declined'],
    ['Работает ли мой мастер?','stylist','check','contacted'],
    ['Я сама запишусь, спасибо','self','leave','client_will_call'],
    ['Перезвоню сама','self','leave','client_will_call'],
    ['Сейчас не делаю покрытие','not_now','close','declined'],
    ['Мне нужно подумать','unsure','clarify','thinking'],
    ['Покрытие на второй день отслоилось','quality','review','callback'],
    ['Ваш мастер нагрубила','quality','review','callback'],
    ['Порезали палец, до сих пор сильно болит','urgent','escalate','callback'],
    ['Верните деньги, маникюр не устроил','quality','listen','callback'],
    ['Какая гарантия на покрытие?','details','check',null],
    ['Откуда вы взяли мой телефон?','privacy','source',null],
    ['Я у вас никогда не была','privacy','verify',null],
    ['Ошиблись номером, я не знаю такую','wrong','close','invalid_number'],
    ['Пожалуйста, удалите номер, больше не звоните','stop','confirm','do_not_contact'],
    ['Не беспокойте, мы в другом салоне','stop','confirm','do_not_contact'],
    ['Абонент недоступен','missed','no_answer','no_answer'],
    ['Не взяла трубку','missed','no_answer','no_answer'],
    ['Хорошо, давайте запишемся','interest','offer','contacted'],
    ['Ага, угу','other','clarify',null]
  ];
  for(const [phrase,key,id,outcome] of cases){
    const suggested=recommend(phrase);
    assert.equal(suggested.key,key,phrase);
    assert.equal(suggested.options[0].id,id,phrase);
    assert.equal(suggested.options[0].outcome,outcome,phrase);
  }
  assert.equal(recommend('не звоните',[],'center','interest').key,'stop');
  assert.equal(recommend('угу, ясно',[],'center','price').key,'price');
  assert.equal(recommend('Ушла в другой салон',[
    {objection:'provider',option:'alternative',helpful:true,branch:'center'}
  ],'center').options[0].id,'respect');
});

test('giving the initiative to the client closes follow-ups without blocking the client',()=>{
  const state=applyCommand(seed(day,true),{type:'import-clients',clients:[sample[0]]}).next;
  const client=state.clients[0];
  const first=applyCommand(state,{type:'record-contact',clientId:client.id,values:{assignee:'alina',
    result:'callback',followUp:day,followUpTime:'15:00',note:''}}).next;
  const followUp=first.tasks.find(task=>task.clientId===client.id);
  const finished=applyCommand(first,{type:'record-contact',clientId:client.id,taskId:followUp.id,
    values:{assignee:'alina',result:'client_will_call',note:'Я сама перезвоню'}}).next;
  assert(finished.tasks.every(task=>task.status==='done'));
  assert(finished.opportunities.every(deal=>deal.stage==='lost'));
  assert.equal(finished.clients[0].callBlocked,undefined);
  assert.equal(finished.tasks[0].result,'client_will_call');
  const later=moneyAudit(finished,{day:shiftDate(day,45)});
  assert.equal(later.rows[0].waitingForClient,true);
  assert.equal(later.rows[0].paused,true);
});

test('automatic assignment respects daily limits, future bookings and staff permissions',()=>{
  const empty=seed(day,true);
  const configured=applyCommand(empty,{type:'agent-settings',auto:true,limit:1}).next;
  const result=applyCommand(configured,{type:'import-clients',clients:sample});
  const state=result.next;
  assert.equal(result.value.assigned,2);
  const first=state.clients.find(client=>client.externalId==='a1');
  const future=state.clients.find(client=>client.externalId==='a3');
  assert.deepEqual(state.tasks.map(task=>task.assignee),['alina','maria']);
  assert(!state.tasks.some(task=>task.clientId===future.id));
  assert.equal(state.tasks[0].priority,'high');
  assert.equal(applyCommand(state,{type:'agent-cycle'}).value.assigned,0);
  assert.throws(()=>commandFor(state,{type:'agent-cycle'},'alina'),/закрыт/);
  assert.throws(()=>commandFor(state,{type:'agent-feedback',clientId:future.id,objection:'price',option:'budget',helpful:true},'alina'),/закрыт/);
  const rate=commandFor(state,{type:'agent-feedback',clientId:first.id,objection:'price',option:'budget',helpful:false},'alina');
  const remembered=applyCommand(applyCommand(state,rate).next,{...rate,helpful:true}).next;
  assert.equal(remembered.agent.feedback.length,1);
  assert.equal(remembered.agent.feedback[0].helpful,true);
  assert.equal(visibleState(remembered,remembered.settings.users.find(user=>user.id==='maria')).agent.feedback.length,0);
});

test('queue navigation advances to the next available client without looping to the saved row',()=>{
  const groups=contactGroups(seed(day),{assignee:'alina'});
  assert(groups.ready.length>1);
  const rows=groups.ready;
  assert.equal(nextContact(rows,rows[0].clientId,rows.slice(1)),rows[1].clientId);
  assert.equal(nextContact(rows,rows.at(-1).clientId,rows),rows[0].clientId);
  assert.equal(nextContact([rows[0]],rows[0].clientId,[rows[0]]),'');
});
