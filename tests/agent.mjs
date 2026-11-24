import test from 'node:test';
import assert from 'node:assert/strict';
import {contactBrief,identifyObjection,recommend} from '../dist/agent.mjs';
import {applyCommand,retentionReason,seed,shiftDate,today} from '../dist/model.mjs';
import {contactGroups,nextContact} from '../dist/contact-desk.mjs';
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
  assert.match(script.opening,/вы уже бывали у нас/);
  assert.equal(script.example,null);
  const repeat=contactBrief({client:state.clients[0],reason:'single',previousResult:'no_answer',followUp:true});
  assert.match(repeat.opening,/пыталась с вами связаться/);
  assert.equal(recommend(repeat.example).options[0].outcome,'callback');
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
