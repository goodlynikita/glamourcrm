import {analyze,segmentKeys} from './retention.mjs';
import {isOpen,validDate} from './finance.mjs';

export const priceFields=['meanCheck','lifetimePaid','lastPaid'];
const positive=value=>Number.isSafeInteger(value)&&value>0;
const shift=(day,days)=>new Date(Date.parse(day)+days*86400000).toISOString().slice(0,10);
const serviceKey=(client,service)=>JSON.stringify([client.branch,service?.trim().toLowerCase().replace(/\s+/g,' ')||'']);
const benchmarkMin=3;
export const priceLabels={
  meanCheck:'Средний чек из файла',
  lifetimePaid:'Оплаты из файла ÷ число визитов',
  lastPaid:'Последняя оплата из файла',
  confirmed:'Последняя подтверждённая оплата',
  benchmark:'Медиана чеков клиентов с той же услугой в филиале'
};

export function moneyAudit(state,{branch='',day,period=30}){
  const clients=state.clients.filter(client=>!branch||client.branch===branch);
  const ids=new Set(clients.map(client=>client.id));
  const deals=new Map(),lastPayment=new Map(),lastVisit=new Map();
  const payments=[];
  const active=new Set(),recentContacts=new Set();
  const recent=shift(day,-30);
  for(const task of state.tasks){
    if(task.status!=='done')active.add(task.clientId);
    else if(task.result&&task.closed>recent)recentContacts.add(task.clientId);
  }
  function addPayment(entry){
    if(!ids.has(entry.clientId)||!positive(entry.amount)||!validDate(entry.date)||entry.date>day)return;
    payments.push(entry);
    if(entry.date>=(lastPayment.get(entry.clientId)?.date??''))lastPayment.set(entry.clientId,entry);
  }
  for(const deal of state.opportunities??[]){
    if(!ids.has(deal.clientId))continue;
    if(isOpen(deal))active.add(deal.clientId);
    if(deal.stage==='booked'){
      if(!deals.has(deal.clientId))deals.set(deal.clientId,[]);
      deals.get(deal.clientId).push(deal);
    }
    if(deal.stage==='paid'){
      addPayment({...deal,amount:deal.actual,date:deal.paymentDate});
      if(validDate(deal.visitDate)&&deal.visitDate<=day&&deal.visitDate>(lastVisit.get(deal.clientId)?.visitDate??''))lastVisit.set(deal.clientId,deal);
    }
  }
  for(const payment of state.recoveries??[])addPayment(payment);

  const direct=new Map(),samples=new Map();
  for(const client of clients){
    const latest=lastPayment.get(client.id);
    const visit=lastVisit.get(client.id);
    const fromDeal=visit&&visit.visitDate>=(client.lastVisit||'');
    const service=fromDeal?visit.service||client.service:client.service;
    let basis='',amount=null;
    if(positive(client.meanCheck)){basis='meanCheck';amount=client.meanCheck;}
    else if(positive(client.lifetimePaid)&&positive(client.visitCount)){
      basis='lifetimePaid';amount=Math.round(client.lifetimePaid/client.visitCount);
    }else if(positive(client.lastPaid)){basis='lastPaid';amount=client.lastPaid;}
    else if(latest){basis='confirmed';amount=latest.amount;}
    if(!positive(amount))continue;
    direct.set(client.id,{basis,amount});
    if(service&&(fromDeal||validDate(client.lastVisit))&&['meanCheck','lastPaid'].includes(basis)){
      const key=serviceKey(client,service);
      if(!samples.has(key))samples.set(key,[]);
      samples.get(key).push(amount);
    }
  }
  const medians=new Map();
  for(const [key,values] of samples){
    if(values.length<benchmarkMin)continue;
    values.sort((a,b)=>a-b);
    medians.set(key,Math.round((values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2));
  }

  const groups=new Map();
  const rows=[];
  let unclassified=0;
  for(const client of clients){
    const pastVisit=lastVisit.get(client.id);
    const importedVisit=client.lastVisit||'';
    const recentVisit=pastVisit&&pastVisit.visitDate>=importedVisit?pastVisit.visitDate:importedVisit;
    const reason=analyze({...state,opportunities:deals.get(client.id)??[]},client,day,recentVisit);
    if(reason==='unknown')unclassified++;
    if(!segmentKeys.includes(reason)||lastPayment.get(client.id)?.date>=recent)continue;
    const service=pastVisit?.visitDate===recentVisit?pastVisit.service||client.service:client.service;
    const estimated=service?medians.get(serviceKey(client,service)):null;
    const price=direct.get(client.id)??(estimated?{basis:'benchmark',amount:estimated}:{basis:'',amount:null});
    const row={client,...price,reason,lastVisit:recentVisit,service,working:active.has(client.id),
      contactable:Boolean(client.phone&&!client.invalidPhone&&!client.callBlocked),
      paused:recentContacts.has(client.id)||client.history?.some(event=>event.kind==='call'&&event.date>recent)||false};
    rows.push(row);
    if(!groups.has(reason))groups.set(reason,{reason,count:0,amount:0,priced:0});
    const group=groups.get(reason);
    group.count++;
    if(price.amount!==null){group.amount+=price.amount;group.priced++;}
  }
  rows.sort((a,b)=>(b.amount??0)-(a.amount??0)||(a.lastVisit||'9999').localeCompare(b.lastVisit||'9999')||a.client.name.localeCompare(b.client.name,'ru'));
  const recorded=payments.filter(payment=>payment.date>=shift(day,1-period)).sort((a,b)=>b.date.localeCompare(a.date));
  return {
    rows,groups:[...groups.values()].sort((a,b)=>b.amount-a.amount||b.count-a.count),
    total:clients.length,unknown:rows.filter(row=>row.amount===null).length,unclassified,
    estimated:rows.filter(row=>row.basis==='benchmark').length,
    open:rows.reduce((sum,row)=>sum+(row.amount??0),0),
    confirmed:recorded.reduce((sum,payment)=>sum+payment.amount,0),recorded
  };
}
