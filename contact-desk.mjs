import {contactQueue,today} from './model.mjs';

export const contactTabs={ready:'К контакту',followup:'Повторные контакты',all:'Все задачи'};
export function contactGroups(state,{branch='',assignee='',day=today(),amounts=new Map()}={}){
  const all=contactQueue(state,{branch,assignee,day}).sort((a,b)=>
    (a.due||'9999').localeCompare(b.due||'9999')||(amounts.get(b.clientId)??0)-(amounts.get(a.clientId)??0));
  return {
    ready:all.filter(row=>row.task?.reason==='followup'?row.due&&row.due<=day:Boolean(row.task)||Boolean(row.due&&row.due<=day)),
    followup:all.filter(row=>row.task?.reason==='followup'),
    all
  };
}
export function nextContact(previous,current,remaining){
  const available=new Set(remaining.map(row=>row.clientId));
  const position=previous.findIndex(row=>row.clientId===current);
  const candidates=[...previous.slice(position+1),...previous.slice(0,Math.max(0,position))];
  return candidates.find(row=>available.has(row.clientId))?.clientId
    || remaining.find(row=>row.clientId!==current)?.clientId || '';
}
