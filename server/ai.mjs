import {moneyAudit} from '../dist/money-audit.mjs';
import {reasons} from '../dist/retention.mjs';

export function analysisInput(snapshot,{branch='',day}){
  const audit=moneyAudit(snapshot,{branch,day});
  return {
    totalCustomers:audit.total,
    returnCandidates:audit.rows.length,
    withoutVisitDate:audit.unclassified,
    withoutPrice:audit.unknown,
    usesComparablePrice:audit.estimated,
    withoutUsablePhone:audit.rows.filter(row=>!row.contactable).length,
    inProgress:audit.rows.filter(row=>row.working).length,
    paymentsInLast30Days:audit.recorded.length,
    groups:audit.groups.map(group=>({
      reason:reasons[group.reason].label,customers:group.count,priced:group.priced,
      shareOfPotential:group.count>=3&&audit.open?Math.round(group.amount*100/audit.open):null
    }))
  };
}

export async function askForAnalysis(input,{key,model='gpt-4.1-mini',request=fetch}){
  const response=await request('https://api.openai.com/v1/responses',{
    method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,store:false,max_output_tokens:650,
      instructions:'Ты анализируешь агрегированную статистику возврата клиентов сети салонов. Дай до трёх конкретных действий на русском, в порядке приоритета. Для каждого поясни, из какого показателя следует действие. Если данных мало, укажи какой информации не хватает. Не выдумывай суммы, причины отказа, вероятности и скидки. Без призывов к рассылке или автоматическому контакту. Пиши короткими абзацами.',
      input:JSON.stringify(input)
    }),
    signal:AbortSignal.timeout(25000)
  });
  if(!response.ok)throw Error('Сервис ИИ недоступен.');
  const {output}=await response.json();
  const result=output?.flatMap(item=>item.content??[])
    .filter(item=>item.type==='output_text').map(item=>item.text).join('\n').trim();
  if(!result)throw Error('ИИ не вернул рекомендации.');
  return result.slice(0,4200);
}
