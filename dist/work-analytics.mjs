import {shiftDate} from './model.mjs';

export const paymentPeriods=[7,30,90];

export function paymentBuckets(records,day,period){
  const count=period===7?7:6;
  const size=period/count;
  const buckets=Array.from({length:count},(_,index)=>({
    from:shiftDate(day,1-period+index*size),
    through:shiftDate(day,(index+1)*size-period),
    amount:0,count:0
  }));
  for(const record of records){
    const bucket=buckets.find(item=>record.date>=item.from&&record.date<=item.through);
    if(bucket){bucket.amount+=record.amount;bucket.count++;}
  }
  return buckets;
}

export const canStartReturn=row=>!row.working&&row.contactable&&!row.paused;

export function branchMoney(audit,branches,clientBranches){
  const groups=new Map(branches.map(branch=>[branch.id,{branch,amount:0,confirmed:0,count:0,priced:0}]));
  for(const row of audit.rows){
    const group=groups.get(row.client.branch);
    if(!group)continue;
    group.count++;
    if(row.amount!==null){group.amount+=row.amount;group.priced++;}
  }
  for(const payment of audit.recorded){
    const group=groups.get(clientBranches.get(payment.clientId));
    if(group)group.confirmed+=payment.amount;
  }
  return [...groups.values()].sort((a,b)=>b.amount-a.amount||b.confirmed-a.confirmed);
}
