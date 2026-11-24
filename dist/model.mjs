import {agentState,defaultAgent,objections} from './agent.mjs';
import {analyze,blockedResults,cleanImport,defaultRules,createImportIndex,importChanges,inWork,priorityFor,reasons,rulesFields,segmentKeys,terminalResults} from './retention.mjs';
import {isOpen,parseMoney,releaseBooking,seedDeals,selectDeals,syncBooking,validDate,writeDeal} from './finance.mjs';

const initialBranches = [
  {id:'center',name:'Центр',label:'GLAMOUR Центр',aliases:['Арбат','GLAMOUR Арбат'],color:'berry'},
  {id:'north',name:'Север',label:'GLAMOUR Север',aliases:['Сокол','GLAMOUR Сокол'],color:'blush'},
  {id:'south',name:'Юг',label:'GLAMOUR Юг',aliases:['Парк Культуры','GLAMOUR Парк Культуры'],color:'pink'}
];
const initialPeople = [
  {id:'alina',name:'Алина Морозова',initials:'АМ',role:'Администратор',branch:'center'},
  {id:'maria',name:'Мария Волкова',initials:'МВ',role:'Администратор',branch:'north'},
  {id:'sofia',name:'София Лебедева',initials:'СЛ',role:'Администратор',branch:'south'},
  {id:'manager',name:'Анна Романова',initials:'АР',role:'Руководитель',branch:''}
];
export let branches=initialBranches;
export let people=initialPeople;
export const settingsFor=state=>state.settings??{rules:{...defaultRules},branches:initialBranches,users:initialPeople};
export function bindDirectory(state){
  ({branches,users:people}=settingsFor(state));
}
export const statuses = {
  new:{label:'К выполнению',tone:'amber'},
  progress:{label:'В работе',tone:'berry'},
  done:{label:'Выполнена',tone:'green'}
};
export const outcomes = {
  booked:'Записан повторно',
  no_answer:'Не дозвонились',
  thinking:'Клиент думает',
  callback:'Перезвонить позже',
  declined:'Не заинтересован',
  contacted:'Заинтересован в записи',
  agreed:'Согласился записаться',
  invalid_number:'Неактуальный номер',
  do_not_contact:'Просит больше не связываться'
};
export const segments = {
  lost:{label:'90+ дней',tone:'red',description:'90 дней и более с последнего визита'},
  attention:{label:'45–89 дней',tone:'amber',description:'От 45 до 89 дней с последнего визита'},
  unknown:{label:'Нет данных',tone:'slate',description:'Дата последнего визита отсутствует'},
  active:{label:'До 45 дней',tone:'green',description:'Менее 45 дней с последнего визита'}
};
export const moscowDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'});
export const today = () => moscowDate.format(new Date());
export const shiftDate = (date, offset) => new Date(Date.parse(date) + offset * 86400000).toISOString().slice(0,10);
export const dateDiff = (a,b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
export const formatDate = (date, options = {day:'numeric',month:'short'}) => date
  ? new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'UTC'}).format(new Date(date.slice(0,10) + 'T12:00:00Z'))
  : '—';
export const longDate = date => formatDate(date,{day:'numeric',month:'long',year:'numeric'});
export const number = value => new Intl.NumberFormat('ru-RU').format(value);
export const initials = name => name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
export const byBranch = (id,state) => (state?settingsFor(state).branches:branches).find(branch=>branch.id===id);
export const byPerson = (id,state) => (state?settingsFor(state).users:people).find(person=>person.id===id);
export const byClient = (state,id) => state.clients.find(client=>client.id===id);
export const newId = () => globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2));
export const phoneKey = input => {
  const digits=String(input ?? '').replace(/\D/g,'');
  if(digits.length===10) return '7'+digits;
  if(digits.length===11 && /^[78]/.test(digits)) return '7'+digits.slice(1);
  return '';
};
export const formatPhone = value => {
  const digits=phoneKey(value);
  if(!digits) return value || '—';
  return '+7 ('+digits.slice(1,4)+') '+digits.slice(4,7)+'-'+digits.slice(7,9)+'-'+digits.slice(9);
};
export function segment(client, day=today()){
  if(!client.lastVisit) return 'unknown';
  const gap=dateDiff(day,client.lastVisit);
  if(gap>=90) return 'lost';
  if(gap>=45) return 'attention';
  return 'active';
}

const clientsSeed = [
  ['Елена Воронцова','center',106,'Маникюр с покрытием'],
  ['Виктория Ланская','center',78,'Укрепление ногтей'],
  ['Дарья Белова','north',132,'Маникюр'],
  ['Ольга Соколова','center',63,'Маникюр и снятие'],
  ['Анна Крылова','south',null,''],
  ['Ксения Орлова','north',59,'Маникюр с дизайном'],
  ['Марина Цветкова','south',96,'Педикюр'],
  ['Ирина Павлова','center',29,'Маникюр с покрытием'],
  ['Полина Миронова','center',93,'Маникюр'],
  ['Анастасия Нечаева','north',84,'Маникюр и снятие'],
  ['Алла Смирнова','south',20,'Маникюр без покрытия'],
  ['Нина Захарова','north',9,'Укрепление ногтей'],
  ['Людмила Осипова','center',null,''],
  ['Татьяна Егорова','south',52,'Маникюр с дизайном'],
  ['Светлана Власова','north',120,'Маникюр с покрытием'],
  ['Валерия Астахова','center',102,'Укрепление ногтей'],
  ['Юлия Родина','center',67,'Маникюр с дизайном'],
  ['Диана Степанова','center',113,'Маникюр'],
  ['Вероника Литвинова','north',71,'Маникюр'],
  ['Зоя Карпова','north',null,''],
  ['Вера Котова','south',99,'Маникюр с дизайном'],
  ['Кристина Громова','south',45,'Укрепление ногтей'],
  ['Надежда Михайлова','north',28,'Педикюр'],
  ['Элина Мельникова','center',13,'Маникюр с покрытием'],
  ['Лидия Берёзкина','center',121,'Маникюр и снятие'],
  ['Майя Синицына','north',100,'Педикюр'],
  ['Яна Васнецова','south',76,'Маникюр с покрытием']
];
const taskSeed = [
  [1,'Уточнить планы на маникюр','alina',0,'new'],
  [2,'Предложить повторный визит','alina',0,'progress'],
  [3,'Вернуть клиента после перерыва','maria',0,'new'],
  [4,'Уточнить удобное время визита','alina',1,'new'],
  [5,'Уточнить историю посещений','sofia',2,'progress'],
  [6,'Предложить запись на дизайн','maria',1,'new'],
  [7,'Напомнить про педикюр','sofia',3,'new'],
  [9,'Предложить время на маникюр','alina',-1,'new'],
  [13,'Проверить данные клиента','alina',3,'new'],
  [15,'Перезвонить по записи','maria',-2,'progress'],
  [16,'Пригласить на укрепление ногтей','alina',0,'new'],
  [17,'Связаться по повторной записи','alina',2,'new'],
  [18,'Уточнить планы на маникюр','alina',4,'new'],
  [8,'Записать на маникюр','alina',-3,'done','booked'],
  [10,'Согласовать время снятия и покрытия','maria',-5,'done','booked'],
  [11,'Предложить время на маникюр','sofia',-4,'done','declined'],
  [12,'Уточнить удобное время визита','maria',-1,'done','no_answer'],
  [14,'Записать на маникюр с дизайном','sofia',-2,'done','booked']
];
export function seed(day=today(),empty=false){
  return {
    version:4,
    agent:defaultAgent(),
    settings:structuredClone(settingsFor({})),
    opportunities:empty?[]:seedDeals(day,shiftDate),
    clients:empty?[]:clientsSeed.map(([name,branch,age,service],index)=>({
      id:'c'+(index+1),name,branch,phone:'7000000'+String(index+1).padStart(4,'0'),
      registered:shiftDate(day,-300-index*3),lastVisit:age===null?'':shiftDate(day,-age),
      service,source:'demo',history:[],
      visitCount:age===null?null:[1,4,1,3,0,2][index%6]||5,
      ...(index===24?{lastCancellation:shiftDate(day,-8),cancelCount:1}:{}),
      ...(index===25?{visitCount:1}:{}),
      ...(index===26?{visitCount:5}:{}),
    })),
    tasks:empty?[]:taskSeed.map(([client,title,assignee,offset,status,result],index)=>({
      id:'t'+(index+1),clientId:'c'+client,title,assignee,due:shiftDate(day,offset),
      status,result:result??'',created:shiftDate(day,-8),closed:status==='done'?shiftDate(day,offset):'',
      appointment:result==='booked'?shiftDate(day,3+index%5):'',service:result==='booked'?clientsSeed[client-1][3]:''
    })),
    imports:[]
  };
}
export function queue(state,{branch='',assignee='',status='',query='',when='',day=today()}={}){
  return state.tasks.filter(task=>{
    const client=byClient(state,task.clientId);
    if(!client || (branch && client.branch!==branch) || (assignee && task.assignee!==assignee)) return false;
    if(task.status!=='done'&&(client.callBlocked||client.invalidPhone||
      (segmentKeys.includes(task.reason)&&retentionReason(state,client,day)==='future')))return false;
    if(status==='open' && task.status==='done') return false;
    if(status && status!=='open' && task.status!==status) return false;
    if(when==='today' && (task.due!==day || task.status==='done')) return false;
    if(when==='late' && (task.due>=day || task.status==='done')) return false;
    return matches(client,query)||task.title.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||a.due.localeCompare(b.due)
    ||(a.dueTime||'99:99').localeCompare(b.dueTime||'99:99')||Number(b.priority==='high')-Number(a.priority==='high')||a.created.localeCompare(b.created));
}
export function matches(client,query){
  const q=query.trim().toLowerCase();
  if(!q) return true;
  const digits=q.replace(/\D/g,'');
  return client.name.toLowerCase().includes(q) || (digits.length>=3 && client.phone.includes(phoneKey(digits)||digits));
}
export function lastKnownVisit(state,client){
  const visits=state.opportunities.filter(deal=>deal.clientId===client.id&&deal.stage==='paid')
    .sort((a,b)=>b.visitDate.localeCompare(a.visitDate));
  const latest=visits[0];
  return latest&&latest.visitDate>=client.lastVisit?{lastVisit:latest.visitDate,service:latest.service||client.service}:client;
}
export const clientSegment=(state,client,day=today())=>segment(lastKnownVisit(state,client),day);
export const retentionReason=(state,client,day=today())=>analyze(state,client,day,lastKnownVisit(state,client).lastVisit);
export function displayedReason(state,client,day=today()){
  const reason=retentionReason(state,client,day);
  return reason!=='future'&&reason!=='excluded'&&inWork(state,client.id)?'working':reason;
}

export function metrics(state,branch='',period=30,day=today(),assignee=''){
  const clients=state.clients.filter(client=>!branch||client.branch===branch);
  const tasks=queue(state,{branch,assignee,day});
  const completed=tasks.filter(task=>task.status==='done' && task.closed>=shiftDate(day,1-period) && task.closed<=day);
  const contacts=clients.flatMap(client=>clientHistory(state,client).filter(event=>event.kind==='call'
    && event.date>=shiftDate(day,1-period) && event.date<=day
    && (!assignee||event.assignee===assignee)));
  return {total:clients.length,attention:clients.filter(client=>segmentKeys.includes(retentionReason(state,client,day))).length,
    today:tasks.filter(task=>task.status!=='done' && task.due===day).length,
    open:tasks.filter(task=>task.status!=='done').length,
    late:tasks.filter(task=>task.status!=='done' && task.due<day).length,
    completed:completed.length, contacts:contacts.length, booked:contacts.filter(event=>event.result==='booked').length};
}
export function clientHistory(state,client){
  const visits=client.lastVisit?[{kind:'visit',date:client.lastVisit,title:client.service||'Посещение салона'}]:[];
  const calls=state.tasks.filter(task=>task.clientId===client.id&&task.result&&!task.systemClosed).map(task=>({
    kind:'call',date:task.closed,result:task.result,assignee:task.assignee,
    note:task.note,appointment:task.appointment,service:task.service,planned:task.planned
  }));
  const payments=state.opportunities.filter(deal=>deal.clientId===client.id&&deal.stage==='paid').map(deal=>({
    kind:'payment',date:deal.paymentDate,assignee:deal.assignee,amount:deal.actual,service:deal.service,visitDate:deal.visitDate
  }));
  const canceled=[...new Set([...(client.cancellations??[]),client.lastCancellation].filter(Boolean))].map(date=>({kind:'visit',date,title:'Отмена записи по выгрузке'}));
  return [...client.history,...calls,...payments,...visits,...canceled].sort((a,b)=>b.date.localeCompare(a.date));
}
export function focusClients(state,branch=''){
  return state.clients.filter(client=>(!branch||client.branch===branch)&&segmentKeys.includes(retentionReason(state,client)))
    .sort((a,b)=>(lastKnownVisit(state,a).lastVisit||'9999').localeCompare(lastKnownVisit(state,b).lastVisit||'9999')||a.name.localeCompare(b.name,'ru'));
}

export function contactQueue(state,{branch='',assignee='',day=today()}={}){
  const rows=new Map();
  for(const task of queue(state,{branch,assignee,status:'open',day})){
    const client=byClient(state,task.clientId);
    const reason=retentionReason(state,client,day);
    if(reason==='excluded'||(reason==='future'&&segmentKeys.includes(task.reason)))continue;
    if(!rows.has(task.clientId))rows.set(task.clientId,{clientId:task.clientId,assignee:task.assignee,due:task.due,task});
  }
  for(const deal of selectDeals(state,{branch,assignee,stage:'open'})){
    if(deal.stage==='booked'||['future','excluded'].includes(retentionReason(state,byClient(state,deal.clientId),day)))continue;
    const taskRow=rows.get(deal.clientId);
    const due=taskRow?.due&&(!deal.due||taskRow.due<deal.due)?taskRow.due:deal.due;
    rows.set(deal.clientId,{clientId:deal.clientId,assignee:taskRow?.assignee||deal.assignee,due,deal,task:taskRow?.task});
  }
  return [...rows.values()].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||a.clientId.localeCompare(b.clientId));
}

export function availableForContact(state,branch='',group='focus'){
  const busy=new Set([
    ...state.tasks.filter(task=>task.status!=='done').map(task=>task.clientId),
    ...state.opportunities.filter(isOpen).map(deal=>deal.clientId)
  ]);
  return focusClients(state,branch).filter(client=>client.phone&&!busy.has(client.id)
    &&(group==='focus'||retentionReason(state,client)===group));
}

function outreachTask(clientId,assignee,due,day,{title='Предложить повторный визит',reason='manual',priority='normal',dueTime='',actor='',originReason=''}={}){
  return {id:newId(),clientId,assignee,due,dueTime,title,reason,originReason,priority,status:'new',created:day,closed:'',
    result:'',note:'',appointment:'',service:'',planned:null,activity:[{date:day,actor,title:'Задача создана'}]};
}

function planNextContact(state,client,values,day,task){
  const deal=state.opportunities.find(item=>item.clientId===client.id&&isOpen(item));
  if(values.result==='booked')return;
  const stop=blockedResults.has(values.result);
  const declined=values.result==='declined';
  if(stop||declined){
    if(values.result==='do_not_contact')client.callBlocked=true;
    if(values.result==='invalid_number')client.invalidPhone=true;
    if(stop)for(const pending of state.tasks.filter(item=>item.clientId===client.id&&item.status!=='done')){
      Object.assign(pending,{status:'done',closed:day,result:values.result,systemClosed:true,
        activity:[...(pending.activity??[]),{date:day,actor:values.assignee,title:'Закрыта: '+outcomes[values.result]}]});
    }
    if(stop&&(!deal||deal.stage==='booked'))return;
  }
  if(deal?.stage!=='booked'||stop||declined){
    const stage=stop||declined?'lost':['contacted','agreed'].includes(values.result)||deal?.stage==='interested'?'interested':'contact';
    writeDeal(state,{
      id:deal?.id,clientId:client.id,assignee:values.assignee,stage,due:values.followUp,
      service:deal?.service||lastKnownVisit(state,client).service,plannedInput:deal?.planned==null?'':deal.planned/100,
      note:deal?.note||'',reason:values.note.trim()||outcomes[values.result]
    },{client,assigneeExists:true,day,newId});
  }
  if(terminalResults.has(values.result))return;
  const planned=state.tasks.find(item=>item.clientId===client.id&&item.status!=='done'&&item.reason==='followup');
  if(planned){
    Object.assign(planned,{assignee:values.assignee,due:values.followUp,dueTime:values.followUpTime||'',
      activity:[...(planned.activity??[]),{date:day,actor:values.assignee,title:'Перенесена на '+values.followUp+(values.followUpTime?' '+values.followUpTime:'')}]});
  }else{
    state.tasks.push(outreachTask(client.id,values.assignee,values.followUp,day,{title:deal?.stage==='booked'?'Перезвонить по записи':'Перезвонить клиенту',
      reason:'followup',originReason:task?.originReason||task?.reason||retentionReason(state,client,day),
      priority:task?.priority||'normal',dueTime:values.followUpTime||'',actor:values.assignee}));
  }
}
function agentCycle(state,day,onlyBranch=''){
  const config=agentState(state);
  const directory=settingsFor(state);
  const branches=[];
  let assigned=0;
  for(const branch of directory.branches){
    if(onlyBranch&&onlyBranch!==branch.id)continue;
    const staff=directory.users.filter(person=>assignedBranches(person).includes(branch.id));
    if(!staff.length)continue;
    const clientIds=new Set(state.clients.filter(client=>client.branch===branch.id).map(client=>client.id));
    const already=state.tasks.filter(task=>task.source==='agent'&&task.created===day&&clientIds.has(task.clientId)).length;
    const remaining=Math.max(0,config.limit-already);
    if(!remaining)continue;
    const cooldown=shiftDate(day,-30);
    const recent=new Set(state.tasks.filter(task=>task.status==='done'&&task.closed>cooldown).map(task=>task.clientId));
    const candidates=availableForContact(state,branch.id).filter(client=>!recent.has(client.id)&&
      !client.history.some(event=>event.kind==='call'&&event.date>cooldown));
    const ranked=candidates.map((client,index)=>{
      const reason=retentionReason(state,client,day);
      return {id:client.id,index,reason,priority:priorityFor(reason,dateDiff(day,lastKnownVisit(state,client).lastVisit),directory.rules)};
    }).sort((a,b)=>Number(b.priority==='high')-Number(a.priority==='high')||a.index-b.index).slice(0,remaining);
    if(!ranked.length)continue;
    const load=new Map(staff.map(person=>[person.id,state.tasks.filter(task=>task.assignee===person.id&&task.status!=='done').length]));
    for(const candidate of ranked){
      const person=staff.reduce((least,next)=>load.get(next.id)<load.get(least.id)?next:least);
      const task=outreachTask(candidate.id,person.id,shiftDate(day,directory.rules.taskDays),day,
        {reason:candidate.reason,priority:candidate.priority});
      task.source='agent';
      task.activity[0].title='Задача создана агентом';
      state.tasks.push(task);
      load.set(person.id,load.get(person.id)+1);
    }
    assigned+=ranked.length;
    branches.push({id:branch.id,assigned:ranked.length});
  }
  if(assigned)state.agent.lastRun={date:day,assigned,branches};
  return assigned;
}

export function upgradeState(state){
  if(Array.isArray(state.opportunities)){
    return state.settings&&state.agent?state:{...state,version:4,settings:structuredClone(settingsFor(state)),agent:state.agent??defaultAgent()};
  }
  const next={...state,version:4,settings:structuredClone(settingsFor(state)),agent:defaultAgent(),opportunities:[]};
  const bookings=[];
  for(const task of state.tasks){
    if(task.result==='booked'&&task.appointment)bookings.push({event:task,clientId:task.clientId,reference:'task:'+task.id,date:task.closed});
  }
  for(const client of state.clients){
    for(const event of client.history){
      if(event.result==='booked'&&event.appointment)bookings.push({event,clientId:client.id,reference:'call:'+event.id,date:event.date});
    }
  }
  bookings.sort((a,b)=>a.date.localeCompare(b.date));
  for(const {event,clientId,reference,date} of bookings){
    syncBooking(next,event,{reference,clientId,day:date,newId:()=>reference});
  }
  return next;
}

export function applyCommand(state,command,fromContact=false){
  let next=structuredClone(upgradeState(state));
  const day=today();
  switch(command.type){
    case 'agent-cycle':
      return {next,value:{assigned:agentCycle(next,day,command.branch)}};
    case 'agent-settings': {
      const limit=Number(command.limit);
      if(typeof command.auto!=='boolean'||!Number.isInteger(limit)||limit<1||limit>50)throw Error('Укажите от 1 до 50 задач на филиал.');
      Object.assign(next.agent,{auto:command.auto,limit});
      return {next,value:{assigned:command.auto?agentCycle(next,day):0}};
    }
    case 'agent-feedback': {
      const client=byClient(next,command.clientId);
      const {objection,option,helpful}=command;
      if(!client||!Object.hasOwn(objections,objection)||!objections[objection].options.some(item=>item[0]===option)||
        typeof helpful!=='boolean')throw Error('Выберите подсказку агента.');
      const entry={clientId:client.id,branch:client.branch,objection,option,helpful,date:day,actor:command.actor||''};
      const existing=next.agent.feedback.findIndex(item=>item.clientId===client.id&&item.objection===objection&&item.option===option);
      if(existing<0)next.agent.feedback.push(entry);
      else next.agent.feedback[existing]=entry;
      return {next,value:{recorded:true}};
    }
    case 'record-contact': {
      const {clientId,taskId,values}=command;
      const client=byClient(next,clientId);
      const task=taskId?next.tasks.find(item=>item.id===taskId):null;
      if(!client||!validAssignee(next,values.assignee,client?.branch)||!Object.hasOwn(outcomes,values.result))throw new Error('Выберите результат контакта.');
      if(client.callBlocked||client.invalidPhone)throw Error('Клиент исключён из контактов.');
      if(taskId&&(!task||task.clientId!==clientId||task.status==='done'))throw new Error('Задача уже закрыта. Откройте очередь заново.');
      const needsDate=!terminalResults.has(values.result);
      if(needsDate&&(!validDate(values.followUp)||values.followUp<day||!validTime(values.followUpTime)||values.result==='callback'&&!values.followUpTime))throw new Error('Укажите дату следующего контакта.');
      const event={assignee:values.assignee,result:values.result,note:values.note??'',service:values.service??'',
        appointment:values.appointment,visitTime:values.visitTime,plannedInput:values.plannedInput,followUp:values.followUp,followUpTime:values.followUpTime};
      next=applyCommand(next,task?{type:'save-task',task:{...task,...event,status:'done'},actor:command.actor}:
        {type:'log-call',clientId,event},true).next;
      planNextContact(next,byClient(next,clientId),event,day,task);
      break;
    }
    case 'assign-outreach': {
      const {branch,assignee,due,group,count}=command;
      const rules=settingsFor(next).rules;
      const deadline=due||shiftDate(day,rules.taskDays);
      if(!byBranch(branch,next)||!validAssignee(next,assignee,branch)||!validDate(deadline)||deadline<day||
        !['focus',...segmentKeys].includes(group)||![10,25,50].includes(count)){
        throw new Error('Проверьте филиал, ответственного и дату.');
      }
      const clients=availableForContact(next,branch,group).slice(0,count);
      for(const client of clients){
        const reason=retentionReason(next,client,day);
        next.tasks.push(outreachTask(client.id,assignee,deadline,day,{reason,
          priority:priorityFor(reason,dateDiff(day,lastKnownVisit(next,client).lastVisit),rules),actor:command.actor}));
      }
      return {next,value:{assigned:clients.length}};
    }
    case 'save-deal': {
      const {values}=command;
      const active=command.mergeBooking&&!values.id&&values.stage==='booked'
        ? next.opportunities.find(deal=>deal.clientId===values.clientId&&isOpen(deal)):null;
      if(active?.stage==='booked')throw new Error('Клиент уже записан. Откройте существующую запись.');
      writeDeal(next,active?{...values,id:active.id,note:values.note||active.note}:values,
        {client:byClient(next,values.clientId),assigneeExists:validAssignee(next,values.assignee,byClient(next,values.clientId)?.branch),day,newId});
      break;
    }
    case 'save-task': {
      const {id,clientId,title,assignee,due,status,result,note,appointment,service}=command.task;
      const client=byClient(next,clientId);
      const old=next.tasks.find(task=>task.id===id);
      const reason=old?.reason||command.task.reason||'manual';
      const dueTime=command.task.dueTime??old?.dueTime??'';
      const priority=command.task.priority||old?.priority||'normal';
      if(!client||!validAssignee(next,assignee,client.branch)||!title.trim()||!validDate(due)||!validTime(dueTime)||
        !Object.hasOwn(statuses,status)||!['high','normal'].includes(priority)||!Object.hasOwn(reasons,reason)||
        (id&&!old)||(old&&old.clientId!==clientId)){
        throw new Error('Заполните обязательные поля задачи.');
      }
      if((client.callBlocked||client.invalidPhone)&&(status!=='done'||old?.status!=='done'||old.result!==result)){
        throw Error('Клиент исключён из новых контактов.');
      }
      if(status!=='done'&&next.tasks.some(task=>task.id!==id&&task.clientId===clientId&&task.status!=='done'&&(task.reason||'manual')===reason)){
        throw Error('У клиента уже есть активная задача по этой причине.');
      }
      if(status==='done' && !Object.hasOwn(outcomes,result)) throw new Error('Выберите результат звонка.');
      if(status==='done' && result==='booked' && !validDate(appointment)) throw new Error('Укажите дату повторной записи.');
      const closed=status==='done'?(old?.closed||day):'';
      const change=status==='done'?'Результат: '+outcomes[result]:!old?'Задача создана':'Задача обновлена';
      const task={id:id||newId(),clientId,title:title.trim(),assignee,due,dueTime,reason,priority,status,created:old?.created||day,
        activity:[...(old?.activity??[]),{date:day,actor:command.actor||assignee,title:change}],
        closed,result:closed?result:'',note:note.trim(),originReason:old?.originReason||'',systemClosed:old?.systemClosed??false,
        appointment:closed&&result==='booked'?appointment:'',service:closed&&result==='booked'?service.trim():'',
        visitTime:closed&&result==='booked'?command.task.visitTime||'':'',
        planned:closed&&result==='booked'?(command.task.plannedInput===undefined?old?.planned??null:parseMoney(command.task.plannedInput)):null};
      const reference='task:'+task.id;
      if(old?.result==='booked'&&(task.result!=='booked'||old.clientId!==clientId))releaseBooking(next,reference,old.clientId,day);
      if(task.result==='booked')syncBooking(next,task,{reference,clientId,day,newId});
      if(old) next.tasks[next.tasks.indexOf(old)]=task;
      else next.tasks.push(task);
      if(closed&&!fromContact&&old?.result!==result){
        const followUp=command.task.followUp||(!terminalResults.has(result)?shiftDate(day,1):'');
        const followUpTime=command.task.followUpTime;
        if(!terminalResults.has(result)&&followUp&&
          (!validDate(followUp)||followUp<day||!validTime(followUpTime)||(result==='callback'&&!followUpTime))){
          throw Error('Укажите дату и время следующего контакта.');
        }
        if(blockedResults.has(result)||result==='declined'||followUp){
          planNextContact(next,client,{result,assignee,note:task.note,followUp,followUpTime},day,task);
        }
      }
      break;
    }
    case 'log-call': {
      const client=byClient(next,command.clientId);
      const {result,assignee,note,appointment,service}=command.event;
      if(!client||!validAssignee(next,assignee,client.branch)||!Object.hasOwn(outcomes,result)) throw new Error('Выберите результат звонка.');
      if(client.callBlocked||client.invalidPhone)throw Error('Клиент исключён из контактов.');
      if(result==='booked'&&!validDate(appointment)) throw new Error('Укажите дату повторной записи.');
      const event={id:newId(),kind:'call',date:day,result,assignee,note:note.trim(),originReason:retentionReason(next,client,day),
        appointment:result==='booked'?appointment:'',service:result==='booked'?service.trim():'',
        visitTime:result==='booked'?command.event.visitTime||'':'',
        planned:result==='booked'?parseMoney(command.event.plannedInput):null};
      client.history.unshift(event);
      if(result==='booked')syncBooking(next,event,{reference:'call:'+event.id,clientId:client.id,day,newId});
      break;
    }
    case 'import-clients': {
      if(!Array.isArray(command.clients)||command.clients.length>20000)throw Error('Допустимо не более 20 000 строк за загрузку.');
      let added=0,updated=0,duplicates=0,conflicts=0;
      const visited=new Set();
      const index=createImportIndex(next.clients);
      for(const raw of command.clients){
        const item=cleanImport(raw,settingsFor(next).branches,day,{demoOnly:command.demoOnly});
        const match=index.find(item);
        if(match.error){conflicts++;continue;}
        if(match.client){
          if(visited.has(match.client.id)){duplicates++;continue;}
          visited.add(match.client.id);
          const fields=importChanges(match.client,item);
          if(!Object.keys(fields).length){duplicates++;continue;}
          if(fields.phone&&match.client.phone!==fields.phone)match.client.invalidPhone=false;
          index.remove(match.client);
          Object.assign(match.client,fields);
          index.add(match.client);
          updated++;
        }else{
          const id=newId();
          const client={lastVisit:'',registered:'',phone:'',service:'',...item,id,source:'import',history:[]};
          next.clients.push(client);
          index.add(client);
          visited.add(id);
          added++;
        }
      }
      next.imports.unshift({id:newId(),name:String(command.filename||'Импорт').slice(0,240),date:day,added,updated,duplicates,conflicts});
      const assigned=next.agent.auto&&(added||updated)?agentCycle(next,day):0;
      return {next,value:{added,updated,duplicates,conflicts,assigned}};
    }
    case 'save-settings': {
      const {rules,branches:directory,users}=command.values;
      const prior=settingsFor(next);
      const normalized={};
      for(const [key,[label,,min,max]] of Object.entries(rulesFields)){
        const value=Number(rules?.[key]);
        if(rules?.[key]===''||!Number.isInteger(value)||value<min||value>max)throw Error(label+': от '+min+' до '+max+'.');
        normalized[key]=value;
      }
      const newBranches=prior.branches.map(branch=>{
        const name=directory?.[branch.id]?.trim();
        if(!name||name.length>80)throw Error('Укажите названия филиалов.');
        return {...branch,name,label:'GLAMOUR '+name,aliases:[...new Set([...branch.aliases,branch.name,branch.label])]};
      });
      const newName=typeof command.values.newBranch==='string'?command.values.newBranch.trim():'';
      if(newName.length>80)throw Error('Название филиала слишком длинное.');
      if(newName)newBranches.push({id:'branch-'+newId(),name:newName,label:'GLAMOUR '+newName,color:'berry',aliases:[]});
      if(new Set(newBranches.map(branch=>branch.name.toLowerCase())).size!==newBranches.length)throw Error('Названия филиалов должны различаться.');
      const newUsers=prior.users.map(person=>{
        if(person.id==='manager')return person;
        const data=users?.[person.id],name=data?.name?.trim();
        const role=data?.role||'admin';
        const assigned=Array.isArray(data?.branches)?[...new Set(data.branches)]:[];
        if(!name||name.length>120||!['admin','manager'].includes(role))throw Error('Укажите имя и роль пользователя.');
        if(role==='manager')return {...person,name,role:'Руководитель',branch:'',branches:[]};
        if(!assigned.length||assigned.some(id=>!newBranches.some(branch=>branch.id===id)))throw Error('Укажите филиалы администратора.');
        return {...person,name,role:'Администратор',branch:assigned[0],branches:assigned};
      });
      const reassigned=next.tasks.some(task=>{
        const owner=newUsers.find(person=>person.id===task.assignee),client=byClient(next,task.clientId);
        return task.status!=='done'&&owner&&client&&!assignedBranches(owner).includes(client.branch);
      });
      const inProgress=next.opportunities.some(deal=>{
        const owner=newUsers.find(person=>person.id===deal.assignee),client=byClient(next,deal.clientId);
        return isOpen(deal)&&owner&&client&&!assignedBranches(owner).includes(client.branch);
      });
      if(reassigned||inProgress)throw Error('Перед снятием филиала переназначьте открытые задачи и записи его администратора.');
      next.settings={rules:normalized,branches:newBranches,users:newUsers};
      break;
    }
    case 'reset-demo':
      return {next:seed(day),value:{reset:true}};
    default: throw new Error('Неизвестная операция.');
  }
  return {next};
}
export const assignedBranches=person=>person?.branches??(person?.branch?[person.branch]:[]);
const validAssignee=(state,id,branch)=>Boolean(branch&&assignedBranches(byPerson(id,state)).includes(branch));
const validTime=value=>!value||/^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function retentionReport(state,{branch='',assignee='',reason='',days=30,day=today()}={}){
  const cutoff=shiftDate(day,1-days);
  const inPeriod=date=>date&&date>=cutoff&&date<=day;
  const clients=state.clients.filter(client=>!branch||client.branch===branch);
  const eligible=clients.filter(client=>{
    const current=retentionReason(state,client,day);
    return reason?current===reason:segmentKeys.includes(current);
  });
  const tasks=queue(state,{branch,assignee,day}).filter(task=>!reason||(task.originReason||task.reason||'manual')===reason);
  const calls=tasks.filter(task=>task.status==='done'&&task.result&&!task.systemClosed&&inPeriod(task.closed));
  const singles=clients.flatMap(client=>client.history.filter(event=>event.kind==='call'&&event.result&&inPeriod(event.date)
    &&(!reason||event.originReason===reason)&&(!assignee||event.assignee===assignee)).map(event=>({...event,clientId:client.id})));
  const work=[...calls,...singles];
  const distinct=results=>new Set(results.map(entry=>entry.clientId)).size;
  const connected=work.filter(event=>!['no_answer','invalid_number'].includes(event.result));
  const manualBookings=reason?[]:state.opportunities.filter(deal=>!deal.bookingRef&&inPeriod(deal.confirmedAt)&&
    !['lost','contact','interested'].includes(deal.stage)&&(!assignee||deal.assignee===assignee)&&clients.some(client=>client.id===deal.clientId));
  return {detected:assignee?null:eligible.length,issued:tasks.filter(task=>inPeriod(task.created)).length,processed:distinct(work),
    connected:distinct(connected),interested:distinct(work.filter(event=>['agreed','booked'].includes(event.result))),
    booked:distinct([...work.filter(event=>event.result==='booked'),...manualBookings]),
    contactBooked:distinct(work.filter(event=>event.result==='booked')),declined:distinct(work.filter(event=>['declined','do_not_contact'].includes(event.result))),
    overdue:tasks.filter(task=>task.status!=='done'&&task.due<day).length};
}
