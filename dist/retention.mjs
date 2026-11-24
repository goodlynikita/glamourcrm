import {validDate,isOpen} from './finance.mjs';

export const reasons={
  inactive:{label:'Давно не посещал',tone:'amber',priority:'normal'},
  single:{label:'Был один раз',tone:'pink',priority:'normal'},
  cancellation:{label:'Отменил запись',tone:'red',priority:'high'},
  regular:{label:'Постоянный клиент пропал',tone:'red',priority:'high'},
  future:{label:'Есть будущая запись',tone:'green'},
  working:{label:'Уже в работе',tone:'berry'},
  excluded:{label:'Связь исключена',tone:'slate'},
  unknown:{label:'Нет данных о визите',tone:'slate'},
  clear:{label:'Без задач на возврат',tone:'green'},
  followup:{label:'Повторный контакт',tone:'berry'},
  manual:{label:'Назначено вручную',tone:'slate'}
};
export const segmentKeys=['cancellation','regular','single','inactive'];
export const priorities={high:{label:'Высокий',tone:'red'},normal:{label:'Обычный',tone:'slate'}};
export const rulesFields={
  inactiveDays:['Давний визит, дней',45,1,730],
  singleDays:['Один визит, дней отсутствия',45,1,730],
  regularVisits:['Постоянный клиент, от числа визитов',3,2,100],
  regularDays:['Постоянный клиент, дней отсутствия',60,1,730],
  cancellationDays:['Учитывать отмены за последние, дней',30,1,730],
  taskDays:['Срок задачи после назначения, дней',2,0,30],
  highDays:['Высокий приоритет после, дней отсутствия',90,1,730]
};
export const defaultRules=Object.fromEntries(Object.entries(rulesFields).map(([key,[,value]])=>[key,value]));
export const terminalResults=new Set(['booked','declined','invalid_number','do_not_contact']);
export const blockedResults=new Set(['invalid_number','do_not_contact']);
export const isDemoPhone=phone=>!phone||/^7000\d{7}$/.test(phone);
const elapsed=(day,date)=>Math.round((Date.parse(day)-Date.parse(date))/86400000);

export function analyze(state,client,day,knownVisit){
  if(client.callBlocked||client.invalidPhone)return 'excluded';
  if((client.nextBooking&&client.nextBooking>=day)||state.opportunities.some(deal=>
    deal.clientId===client.id&&deal.stage==='booked'&&deal.visitDate>=day))return 'future';
  const rules=state.settings?.rules??defaultRules;
  const canceled=client.lastCancellation;
  if(canceled&&canceled<=day&&elapsed(day,canceled)<=rules.cancellationDays&&(!knownVisit||canceled>knownVisit)
    &&(!client.nextBooking||canceled>=client.nextBooking))return 'cancellation';
  if(!knownVisit)return 'unknown';
  const gap=elapsed(day,knownVisit);
  if(Number.isInteger(client.visitCount)&&client.visitCount>=rules.regularVisits&&gap>=rules.regularDays)return 'regular';
  if(client.visitCount===1&&gap>=rules.singleDays)return 'single';
  return gap>=rules.inactiveDays?'inactive':'clear';
}
export function inWork(state,clientId){
  return state.tasks.some(task=>task.clientId===clientId&&task.status!=='done')||
    state.opportunities.some(deal=>deal.clientId===clientId&&isOpen(deal)&&deal.stage!=='booked');
}
export const priorityFor=(reason,gap,rules)=>reasons[reason]?.priority==='high'||gap>=rules.highDays?'high':'normal';

export function createImportIndex(existing){
  const ids=new Map(),phones=new Map();
  const indexKey=(row,key)=>row[key]?JSON.stringify([row.branch,row[key]]):'';
  const update=(row,add)=>{
    for(const [map,key] of [[ids,'externalId'],[phones,'phone']]){
      const index=indexKey(row,key);
      if(!index)continue;
      if(add){
        if(!map.has(index))map.set(index,new Set());
        map.get(index).add(row);
      }else{
        const matches=map.get(index);
        matches?.delete(row);
        if(matches?.size===0)map.delete(index);
      }
    }
  };
  for(const row of existing)update(row,true);
  return {
    find(row){
      const exact=ids.get(indexKey(row,'externalId'));
      const phone=phones.get(indexKey(row,'phone'));
      const byId=exact?.values().next().value;
      const byPhone=phone?.values().next().value;
      if((exact?.size>1)||(phone?.size>1)||(byId&&byPhone&&byId!==byPhone)||
        (row.externalId&&byPhone?.externalId&&byPhone.externalId!==row.externalId)){
        return {error:'ID и телефон совпадают с разными карточками. Проверьте строку.'};
      }
      return {client:byId||byPhone};
    },
    add:row=>update(row,true),
    remove:row=>update(row,false)
  };
}
export const importFields=['name','phone','branch','externalId','lastVisit','registered','service','visitCount','nextBooking','lastCancellation','cancelCount','cancellations'];
export function cleanImport(item,branches,day,{demoOnly=false}={}){
  if(!item||typeof item!=='object')throw Error('Неверная строка.');
  const text=(key,limit)=>{
    if(typeof item[key]!=='string'||item[key].length>limit)throw Error('Проверьте поле '+key+'.');
    return item[key].trim();
  };
  const record={name:text('name',160),branch:text('branch',64)};
  if(!record.name||!branches.some(branch=>branch.id===record.branch))throw Error('Укажите клиента и филиал.');
  for(const [key,limit] of [['phone',11],['externalId',120],['service',200]]){
    if(Object.hasOwn(item,key))record[key]=text(key,limit);
  }
  if(record.phone&&!/^7\d{10}$/.test(record.phone))throw Error('Проверьте номер телефона.');
  if(demoOnly&&!isDemoPhone(record.phone))throw Error('В демо допустимы только вымышленные телефоны +7 (000) …');
  for(const key of ['lastVisit','registered','nextBooking','lastCancellation']){
    if(!Object.hasOwn(item,key))continue;
    const value=text(key,10);
    if(value&&(!validDate(value)||(key!=='nextBooking'&&value>day)))throw Error('Проверьте дату '+key+'.');
    record[key]=value;
  }
  for(const key of ['visitCount','cancelCount']){
    if(!Object.hasOwn(item,key))continue;
    const value=item[key];
    if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>100000))throw Error('Проверьте количество.');
    record[key]=value;
  }
  if(Object.hasOwn(item,'cancellations')){
    if(!Array.isArray(item.cancellations)||item.cancellations.length>200||
      item.cancellations.some(date=>typeof date!=='string'||!validDate(date)||date>day))throw Error('Проверьте историю отмен.');
    record.cancellations=[...new Set(item.cancellations)].sort().reverse();
    if(record.cancellations.length&&(!record.lastCancellation||record.cancellations[0]>record.lastCancellation)){
      record.lastCancellation=record.cancellations[0];
    }
  }
  if(!record.phone&&!record.externalId)throw Error('Нужен телефон или ID для поиска дублей.');
  return record;
}

export function importChanges(previous,incoming){
  return Object.fromEntries(importFields.filter(key=>Object.hasOwn(incoming,key)&&
    (!['phone','externalId'].includes(key)||incoming[key])&&
    JSON.stringify(previous[key]??null)!==JSON.stringify(incoming[key])).map(key=>[key,incoming[key]]));
}
