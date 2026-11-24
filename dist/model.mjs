import {parseMoney, releaseBooking, seedDeals, syncBooking, validDate, writeDeal} from './finance.mjs';

export const branches = [
  {id:'center',name:'Центр',label:'GLAMOUR Центр',aliases:['Арбат','GLAMOUR Арбат'],color:'berry'},
  {id:'north',name:'Север',label:'GLAMOUR Север',aliases:['Сокол','GLAMOUR Сокол'],color:'blush'},
  {id:'south',name:'Юг',label:'GLAMOUR Юг',aliases:['Парк Культуры','GLAMOUR Парк Культуры'],color:'pink'}
];
export const people = [
  {id:'alina',name:'Алина Морозова',initials:'АМ',role:'Администратор',branch:'center'},
  {id:'maria',name:'Мария Волкова',initials:'МВ',role:'Администратор',branch:'north'},
  {id:'sofia',name:'София Лебедева',initials:'СЛ',role:'Администратор',branch:'south'},
  {id:'manager',name:'Анна Романова',initials:'АР',role:'Руководитель',branch:''}
];
export const statuses = {
  new:{label:'К выполнению',tone:'amber'},
  progress:{label:'В работе',tone:'berry'},
  done:{label:'Выполнена',tone:'green'}
};
export const outcomes = {
  booked:'Записан повторно',
  no_answer:'Не дозвонились',
  callback:'Перезвонить позже',
  declined:'Отказ от записи',
  contacted:'Связались'
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
export const byBranch = id => branches.find(branch=>branch.id===id);
export const byPerson = id => people.find(person=>person.id===id);
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
  ['Элина Мельникова','center',13,'Маникюр с покрытием']
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
export function seed(day=today()){
  return {
    version:2,
    opportunities:seedDeals(day,shiftDate),
    clients:clientsSeed.map(([name,branch,age,service],index)=>({
      id:'c'+(index+1),name,branch,phone:'7000000'+String(index+1).padStart(4,'0'),
      registered:shiftDate(day,-300-index*3),lastVisit:age===null?'':shiftDate(day,-age),
      service,source:'demo',history:[]
    })),
    tasks:taskSeed.map(([client,title,assignee,offset,status,result],index)=>({
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
    if(status==='open' && task.status==='done') return false;
    if(status && status!=='open' && task.status!==status) return false;
    if(when==='today' && (task.due!==day || task.status==='done')) return false;
    if(when==='late' && (task.due>=day || task.status==='done')) return false;
    return matches(client,query)||task.title.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||a.due.localeCompare(b.due)||a.created.localeCompare(b.created));
}
export function matches(client,query){
  const q=query.trim().toLowerCase();
  if(!q) return true;
  const digits=q.replace(/\D/g,'');
  return client.name.toLowerCase().includes(q) || (digits.length>=3 && client.phone.includes(digits));
}
export function lastKnownVisit(state,client){
  const visits=state.opportunities.filter(deal=>deal.clientId===client.id&&deal.stage==='paid')
    .sort((a,b)=>b.visitDate.localeCompare(a.visitDate));
  const latest=visits[0];
  return latest&&latest.visitDate>=client.lastVisit?{lastVisit:latest.visitDate,service:latest.service||client.service}:client;
}
export const clientSegment=(state,client,day=today())=>segment(lastKnownVisit(state,client),day);

export function metrics(state,branch='',period=30,day=today(),assignee=''){
  const clients=state.clients.filter(client=>!branch||client.branch===branch);
  const tasks=queue(state,{branch,assignee,day});
  const completed=tasks.filter(task=>task.status==='done' && task.closed>=shiftDate(day,1-period) && task.closed<=day);
  const contacts=clients.flatMap(client=>clientHistory(state,client).filter(event=>event.kind==='call'
    && event.date>=shiftDate(day,1-period) && event.date<=day
    && (!assignee||event.assignee===assignee)));
  return {total:clients.length,attention:clients.filter(client=>clientSegment(state,client,day)!=='active').length,
    today:tasks.filter(task=>task.status!=='done' && task.due===day).length,
    open:tasks.filter(task=>task.status!=='done').length,
    late:tasks.filter(task=>task.status!=='done' && task.due<day).length,
    completed:completed.length, contacts:contacts.length, booked:contacts.filter(event=>event.result==='booked').length};
}
export function clientHistory(state,client){
  const visits=client.lastVisit?[{kind:'visit',date:client.lastVisit,title:client.service||'Посещение салона'}]:[];
  const calls=state.tasks.filter(task=>task.clientId===client.id && task.result).map(task=>({
    kind:'call',date:task.closed,result:task.result,assignee:task.assignee,
    note:task.note,appointment:task.appointment,service:task.service,planned:task.planned
  }));
  const payments=state.opportunities.filter(deal=>deal.clientId===client.id&&deal.stage==='paid').map(deal=>({
    kind:'payment',date:deal.paymentDate,assignee:deal.assignee,amount:deal.actual,service:deal.service,visitDate:deal.visitDate
  }));
  return [...client.history,...calls,...payments,...visits].sort((a,b)=>b.date.localeCompare(a.date));
}
export function focusClients(state,branch=''){
  return state.clients.filter(client=>(!branch||client.branch===branch)&&clientSegment(state,client)!=='active')
    .sort((a,b)=>(lastKnownVisit(state,a).lastVisit||'9999').localeCompare(lastKnownVisit(state,b).lastVisit||'9999')||a.name.localeCompare(b.name,'ru'));
}

export function upgradeState(state){
  if(Array.isArray(state.opportunities))return state;
  const next={...state,version:2,opportunities:[]};
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

export function applyCommand(state,command){
  const next=structuredClone(upgradeState(state));
  const day=today();
  switch(command.type){
    case 'save-deal': {
      const {values}=command;
      writeDeal(next,values,{client:byClient(next,values.clientId),assigneeExists:Boolean(byPerson(values.assignee)?.branch),day,newId});
      break;
    }
    case 'save-task': {
      const {id,clientId,title,assignee,due,status,result,note,appointment,service}=command.task;
      if(!byClient(next,clientId) || !byPerson(assignee)?.branch || !title.trim() || !due || !statuses[status]){
        throw new Error('Заполните обязательные поля задачи.');
      }
      if(status==='done' && !outcomes[result]) throw new Error('Выберите результат звонка.');
      if(status==='done' && result==='booked' && !validDate(appointment)) throw new Error('Укажите дату повторной записи.');
      const old=next.tasks.find(task=>task.id===id);
      const closed=status==='done'?(old?.closed||day):'';
      const task={id:id||newId(),clientId,title:title.trim(),assignee,due,status,created:old?.created||day,
        closed,result:closed?result:'',note:note.trim(),
        appointment:closed&&result==='booked'?appointment:'',service:closed&&result==='booked'?service.trim():'',
        planned:closed&&result==='booked'?(command.task.plannedInput===undefined?old?.planned??null:parseMoney(command.task.plannedInput)):null};
      const reference='task:'+task.id;
      if(old?.result==='booked'&&(task.result!=='booked'||old.clientId!==clientId))releaseBooking(next,reference,old.clientId,day);
      if(task.result==='booked')syncBooking(next,task,{reference,clientId,day,newId});
      if(old) next.tasks[next.tasks.indexOf(old)]=task;
      else next.tasks.push(task);
      break;
    }
    case 'log-call': {
      const client=byClient(next,command.clientId);
      const {result,assignee,note,appointment,service}=command.event;
      if(!client || !outcomes[result]) throw new Error('Выберите результат звонка.');
      if(result==='booked'&&!validDate(appointment)) throw new Error('Укажите дату повторной записи.');
      const event={id:newId(),kind:'call',date:day,result,assignee,note:note.trim(),
        appointment:result==='booked'?appointment:'',service:result==='booked'?service.trim():'',
        planned:result==='booked'?parseMoney(command.event.plannedInput):null};
      client.history.unshift(event);
      if(result==='booked')syncBooking(next,event,{reference:'call:'+event.id,clientId:client.id,day,newId});
      break;
    }
    case 'import-clients': {
      const seen=importKeys(next.clients);
      let added=0;
      let duplicates=0;
      for(const item of command.clients){
        if(isDuplicate(seen,item)){duplicates++;continue;}
        addImportKeys(seen,item);
        next.clients.push({...item,id:newId(),source:'import',history:[]});
        added++;
      }
      if(added>0) next.imports.unshift({id:newId(),name:command.filename,date:day,added});
      return {next,value:{added,duplicates}};
    }
    default: throw new Error('Неизвестная операция.');
  }
  return {next};
}
export function importKeys(clients){
  const keys=new Set();
  clients.forEach(item=>addImportKeys(keys,item));
  return keys;
}
function keysFor(item){
  return [item.phone&&item.branch+':phone:'+item.phone,item.externalId&&item.branch+':id:'+item.externalId].filter(Boolean);
}
export const isDuplicate=(keys,item)=>keysFor(item).some(key=>keys.has(key));
export const addImportKeys=(keys,item)=>keysFor(item).forEach(key=>keys.add(key));
