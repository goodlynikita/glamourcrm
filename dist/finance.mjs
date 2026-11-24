export const stages={
  contact:{label:'Связаться',tone:'slate',next:'interested',action:'Уточнить интерес'},
  interested:{label:'Есть интерес',tone:'pink',next:'booked',action:'Предложить время'},
  booked:{label:'Записан',tone:'amber',next:'paid',action:'Отметить визит и оплату'},
  paid:{label:'Оплачено',tone:'green'},
  recovered:{label:'Возврат подтверждён',tone:'green'},
  lost:{label:'Закрыто без визита',tone:'red'}
};
export const isOpen=deal=>Boolean(stages[deal.stage]?.next);
const moneyFormat=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2});
export const money=cents=>cents===null||cents===undefined?'—':moneyFormat.format(cents/100);
export const moneyInput=cents=>cents===null||cents===undefined?'':String(cents/100).replace('.',',');
export function parseMoney(value){
  const raw=String(value??'').trim().replace(/[ \u00a0\u202f]/g,'');
  if(!raw)return null;
  if(!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(raw))throw new Error('Введите сумму в рублях, например 2 450,50.');
  const [whole,fraction='']=raw.split(/[.,]/);
  return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
export function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value??''))return false;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
const validTime=value=>!value||/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const actionDate=deal=>deal.stage==='booked'?deal.visitDate:deal.due;
export function nextStep(deal,day){
  if(deal.stage==='booked')return deal.visitDate<day?'Проверить результат визита':
    deal.visitDate===day?'Отметить визит после оплаты':'Подтвердить визит';
  return stages[deal.stage].action??'';
}
export function selectDeals(state,{branch='',assignee='',stage=''}={}){
  const clients=new Map(state.clients.map(client=>[client.id,client]));
  return state.opportunities.filter(deal=>{
    const client=clients.get(deal.clientId);
    return client&&(!branch||client.branch===branch)&&(!assignee||deal.assignee===assignee)
      &&(!stage||(stage==='open'?isOpen(deal):stage===deal.stage));
  }).sort((a,b)=>Number(isOpen(b))-Number(isOpen(a))
    ||(isOpen(a)?(actionDate(a)||'9999').localeCompare(actionDate(b)||'9999'):b.updated.localeCompare(a.updated))
    ||a.created.localeCompare(b.created));
}
export function financeReport(state,{branch='',assignee='',from,through,day}){
  const deals=selectDeals(state,{branch,assignee});
  const candidates=deals.filter(deal=>deal.stage==='contact'||deal.stage==='interested');
  const upcoming=deals.filter(deal=>deal.stage==='booked'&&deal.visitDate>=day&&deal.visitDate<=through);
  const paid=deals.filter(deal=>deal.stage==='paid'&&deal.paymentDate>=from&&deal.paymentDate<=day);
  const overdue=deals.filter(deal=>isOpen(deal)&&actionDate(deal)&&actionDate(deal)<day);
  const sum=(records,key)=>records.reduce((total,record)=>total+(record[key]??0),0);
  const revenue=sum(paid,'actual');
  return {
    revenue,paidCount:paid.length,average:paid.length?Math.round(revenue/paid.length):null,
    booked:sum(upcoming,'planned'),bookedCount:upcoming.length,bookedUnpriced:upcoming.filter(deal=>deal.planned===null).length,
    potential:sum(candidates,'planned'),potentialCount:candidates.length,potentialUnpriced:candidates.filter(deal=>deal.planned===null).length,
    overdue:overdue.length
  };
}

export function writeDeal(state,values,{client,assigneeExists,day,newId}){
  const old=state.opportunities.find(deal=>deal.id===values.id);
  const stage=values.stage;
  if(!client||!assigneeExists||!Object.hasOwn(stages,stage))throw new Error('Выберите клиента, ответственного и этап.');
  if(old&&old.clientId!==client.id)throw new Error('У существующей записи клиент фиксирован.');
  if(old?.stage==='paid'&&stage!=='paid')throw new Error('Для оплаченного визита доступны правки даты и суммы.');
  if(stages[stage].next&&state.opportunities.some(deal=>deal.id!==old?.id&&deal.clientId===client.id&&isOpen(deal))){
    throw new Error('У клиента уже есть активная запись в воронке. Откройте её в карточке клиента.');
  }
  const planned=parseMoney(values.plannedInput);
  const actual=stage==='paid'?parseMoney(values.actualInput):null;
  const due=stage==='contact'||stage==='interested'?String(values.due??''):'';
  const visitDate=stage==='booked'||stage==='paid'?String(values.visitDate??''):'';
  const paymentDate=stage==='paid'?String(values.paymentDate??''):'';
  const visitTime=visitDate?String(values.visitTime??old?.visitTime??''):'';
  if(!validTime(visitTime))throw new Error('Проверьте время записи.');
  const reason=stage==='lost'?String(values.reason??'').trim():'';
  if(due&&!validDate(due))throw new Error('Проверьте дату следующего шага.');
  if((stage==='booked'||stage==='paid')&&!validDate(visitDate))throw new Error('Укажите дату визита.');
  if(stage==='paid'&&(!actual||!validDate(paymentDate)||paymentDate>day||visitDate>day)){
    throw new Error('Для оплаченного визита укажите сумму больше нуля и состоявшиеся даты визита и оплаты.');
  }
  if(stage==='lost'&&!reason)throw new Error('Укажите причину закрытия.');
  const deal={
    id:old?.id||newId(),clientId:client.id,assignee:values.assignee,stage,
    service:String(values.service??'').trim(),note:String(values.note??'').trim(),planned,actual,
    due,visitDate,visitTime,paymentDate,reason,created:old?.created||day,updated:day,
    confirmedAt:old?.confirmedAt||(stage==='booked'?day:''),
    bookingRef:old?.bookingRef||'',resumeStage:old?.resumeStage||'',resumeDue:old?.resumeDue||''
  };
  if(old)state.opportunities[state.opportunities.indexOf(old)]=deal;
  else state.opportunities.push(deal);
}
export function releaseBooking(state,reference,clientId,day){
  const deal=state.opportunities.find(item=>item.bookingRef===reference&&item.clientId===clientId);
  if(deal?.stage!=='booked')return;
  Object.assign(deal,{stage:deal.resumeStage||'interested',due:deal.resumeDue||'',visitDate:'',bookingRef:'',resumeStage:'',resumeDue:'',updated:day});
}
export function syncBooking(state,booking,{reference,clientId,day,newId}){
  const linked=state.opportunities.find(item=>item.bookingRef===reference&&item.clientId===clientId);
  if(linked&&!isOpen(linked))return;
  if(!validTime(booking.visitTime))throw new Error('Проверьте время записи.');
  const deal=linked||state.opportunities.find(item=>item.clientId===clientId&&isOpen(item));
  const items={
    stage:'booked',visitDate:booking.appointment,visitTime:booking.visitTime||'',confirmedAt:deal?.confirmedAt||day,updated:day,bookingRef:reference,due:'',
    resumeStage:(deal?.stage==='booked'?deal.resumeStage:deal?.stage)||'',
    resumeDue:(deal?.stage==='booked'?deal.resumeDue:deal?.due)||'',
    assignee:booking.assignee,service:booking.service||deal?.service||'',
    planned:booking.planned??deal?.planned??null
  };
  if(deal)Object.assign(deal,items);
  else state.opportunities.push({
    id:newId(),clientId,created:day,note:'',actual:null,paymentDate:'',reason:'',...items
  });
}

export function seedDeals(day,shiftDate){
  const seeds=[
    [1,'alina','contact','Маникюр с покрытием',2300,-1],
    [2,'alina','interested','Укрепление ногтей',2800,0],
    [3,'maria','contact','Маникюр с покрытием',2200,0],
    [4,'alina','interested','Маникюр с дизайном',3000,1],
    [5,'sofia','contact','Консультация',null,2],
    [7,'sofia','interested','Педикюр с покрытием',3300,3],
    [8,'alina','booked','Маникюр с покрытием',2400,6,'task:t14'],
    [10,'maria','booked','Маникюр и снятие',2650,7,'task:t15'],
    [14,'sofia','booked','Маникюр с дизайном',3150,5,'task:t18'],
    [20,'maria','contact','Маникюр',1850,1],
    [23,'maria','booked','Педикюр',2900,-1],
    [11,'sofia','lost','Маникюр',2200,-4],
    [16,'alina','paid','Маникюр с укреплением',2600,-2,2700],
    [19,'maria','paid','Маникюр с покрытием',2300,-5,2300],
    [22,'sofia','paid','Педикюр с покрытием',3200,-9,3200],
    [24,'alina','paid','Маникюр с дизайном',2900,-16,3100]
  ];
  return seeds.map(([client,assignee,stage,service,amount,offset,reference],index)=>{
    const date=shiftDate(day,offset);
    return {id:'d'+(index+1),clientId:'c'+client,assignee,stage,service,
      planned:amount===null?null:amount*100,actual:stage==='paid'?reference*100:null,
      due:stage==='contact'||stage==='interested'?date:'',visitDate:stage==='booked'||stage==='paid'?date:'',
      visitTime:stage==='booked'?['10:30','12:00','14:30','16:00'][index%4]:'',
      paymentDate:stage==='paid'?date:'',reason:stage==='lost'?'Клиент перенёс планы':'',note:'',
      created:shiftDate(day,Math.min(-7,offset-2)),updated:stage==='paid'?date:shiftDate(day,-2),
      bookingRef:stage==='booked'&&typeof reference==='string'?reference:'',resumeStage:'',resumeDue:''
    };
  });
}
