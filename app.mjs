import {agentState,contactBrief,identifyObjection,objections,recommend} from './agent.mjs?v=9';
import {contactGroups,contactTabs,nextContact} from './contact-desk.mjs';
import {priorities,reasons,rulesFields,segmentKeys,terminalResults} from './retention.mjs?v=9';
import {icon} from './icons.mjs';
import * as m from './model.mjs?v=9';
import {readFile,previewRows,demoCsv,detectColumns,fieldLabels} from './importer.mjs';
import {repository,storageKey,serverMode,demoMode} from './repository.mjs?v=9';
import {money} from './finance.mjs';
import {moneyAudit,priceLabels} from './money-audit.mjs?v=9';
import {branchMoney,canStartReturn,paymentBuckets,paymentPeriods} from './work-analytics.mjs';

const app=document.querySelector('#app');
const dialog=document.querySelector('#dialog');
const toastEl=document.querySelector('#toast');
const preferencesKey='glamour-crm-preferences';
let savedPrefs={};
try {savedPrefs=JSON.parse(localStorage.getItem(preferencesKey)||'{}');} catch {}
const routes={
  home:['Деньги в базе','wallet'],contacts:['Очередь','phone'],clients:['Клиенты','users'],
  agent:['Агент','sparkle'],import:['Импорт','upload'],settings:['Настройки','checkList']
};
const pageFromHash=()=>{
  const page=location.hash.slice(1);
  return Object.hasOwn(routes,page)?page:page==='tasks'?'contacts':'home';
};
const queueTabs={...contactTabs,priority:'К возврату'};
const ui={
  page:pageFromHash(),theme:savedPrefs.theme==='dark'?'dark':'light',profile:m.byPerson(savedPrefs.profile)?.id||'manager',
  branch:m.byBranch(savedPrefs.branch)?.id||'',query:'',segment:'',
  homeFilter:'ready',homeReason:'',homeLimit:8,moneyView:'reason',payWindow:'',contactReason:'',contactTab:'ready',contactClient:'',contactPinned:false,
  clientSort:'money',period:30,mobileNav:false,importFile:null,importLayout:null,importMapping:null,importPreview:null,importError:'',
  importBusy:false,fallback:m.byBranch(savedPrefs.branch)?.id||'center',clientLimit:12
};
let state, rawState, account, modal, toastTimer,contactSaving=false,aiAvailable=false,aiReport,auditCache=new Map();
const contactDrafts=new Map();
const s=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const attr=(name,value)=>' '+name+'="'+s(value)+'"';
const person=()=>serverMode?account:m.byPerson(ui.profile,rawState);
const manager=()=>!person()?.branch;
const managerPages=new Set(['import','settings','agent']);
const assignees=()=>m.people.filter(p=>p.branch&&(manager()||p.id===ui.profile));
const defaultAssignee=branch=>assignees().find(p=>m.assignedBranches(p).includes(branch))?.id;
const mine=()=>manager()?'':ui.profile;
const opts=(items,value)=>items.map(([key,label])=>'<option value="'+s(key)+'"'+(key===value?' selected':'')+'>'+s(label)+'</option>').join('');
const branchOpts=(current,all)=>opts([...(all?[['','Все филиалы']]:[]),...m.branches.map(b=>[b.id,b.label])],current);
const tag=(label,tone)=>'<span class="tag '+tone+'"><span></span>'+s(label)+'</span>';
const badge=(key,list=m.statuses)=>tag(list[key].label,list[key].tone);
const reasonTitle=key=>reasons[key||'manual']?.label||reasons.manual.label;
const iconBox=(name,tone)=>'<span class="icon-box '+tone+'">'+icon(name,19)+'</span>';
const wordmark='<img class="studio-wordmark" src="./assets/glamour-wordmark.webp" width="740" height="298" alt="">';
const tones=['berry','pink','stone','mint','peach'];
const avatar=(name,index=0)=>'<span aria-hidden="true" class="avatar '+tones[index%tones.length]+'">'+s(m.initials(name))+'</span>';
const clientAvatar=client=>avatar(client.name,Number(client.id.replace(/^c/,'').slice(0,2))||client.name.charCodeAt(0));
const control=(label,contents,classes='')=>'<label class="select-control '+classes+'"><span class="sr-only">'+s(label)+'</span>'+contents+icon('chevron',15)+'</label>';
const button=(label,ic,style,action,extra='')=>'<button type="button" class="button '+style+'" data-action="'+action+'" '+extra+'>'+ (ic?icon(ic,17):'')+s(label)+'</button>';
const empty=(title,text,ic='folder')=>'<div class="empty">'+iconBox(ic,'berry')+'<strong>'+s(title)+'</strong>'+(text?'<p>'+s(text)+'</p>':'')+'</div>';
const typeIcon={visit:'calendar',call:'phone',payment:'wallet'};

function savePrefs(){
  try {localStorage.setItem(preferencesKey,JSON.stringify({theme:ui.theme,profile:ui.profile,branch:ui.branch}));} catch {}
}
function applyTheme(){
  document.documentElement.dataset.theme=ui.theme;
  document.querySelector('meta[name="theme-color"]').content=ui.theme==='dark'?'#1d171b':'#fdf7fa';
}
function notify(message,error=false){
  toastEl.innerHTML='<div class="toast '+(error?'toast-error':'')+'">'+icon(error?'info':'check',18)+'<span>'+s(message)+'</span></div>';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.replaceChildren(),4200);
}
function useSnapshot(snapshot){
  rawState=m.upgradeState(snapshot);
  if(serverMode)account=m.byPerson(ui.profile,rawState.settings?rawState:undefined)||account;
  if(!serverMode&&person()?.branch){
    const owned=m.assignedBranches(person());
    const clients=rawState.clients.filter(client=>owned.includes(client.branch));
    const ids=new Set(clients.map(client=>client.id));
    const settings=m.settingsFor(rawState);
    state={...rawState,clients,tasks:rawState.tasks.filter(task=>ids.has(task.clientId)),
      recoveries:rawState.recoveries.filter(entry=>ids.has(entry.clientId)),
      opportunities:rawState.opportunities.filter(deal=>ids.has(deal.clientId)),imports:[],
      agent:{...rawState.agent,lastRun:null,feedback:rawState.agent.feedback.filter(item=>owned.includes(item.branch))},
      settings:{...settings,branches:settings.branches.filter(branch=>owned.includes(branch.id)),
        users:settings.users.filter(user=>m.assignedBranches(user).some(branch=>owned.includes(branch)))}};
  }else state=rawState;
  auditCache.clear();
  m.bindDirectory(state);
  if(ui.branch&&!m.byBranch(ui.branch))ui.branch='';
  if(!m.byBranch(ui.fallback))ui.fallback=m.branches[0]?.id||'';
}
async function run(command,{refresh=true}={}){
  try{
    const response=await repository.dispatch({...command,actor:ui.profile});
    useSnapshot(response.state);
    if(refresh)render();
    return response.value;
  }catch(error){
    if(serverMode&&error.status===401){account=null;closeModal();renderLogin('Сессия завершилась. Войдите снова.');}
    throw error;
  }
}
function resetNav(){
  Object.assign(ui,{query:'',segment:'',clientSort:'money',clientLimit:12,homeFilter:'ready',homeReason:'',
    homeLimit:8,contactReason:'',contactTab:'ready',contactClient:'',contactPinned:false,mobileNav:false});
}
function go(page,filters={}){
  if(managerPages.has(page)&&!manager())page='home';
  resetNav();
  Object.assign(ui,filters,{page});
  if(location.hash!=='#'+page) history.pushState(null,'','#'+page);
  render();
  window.scrollTo(0,0);
}
window.addEventListener('popstate',()=>{
  if(ui.page!==pageFromHash()) go(pageFromHash());
});
window.addEventListener('storage',async event=>{
  if(event.key===storageKey){
    try {useSnapshot(await repository.read());if(!dialog.open)render();}
    catch {notify('Обновлённые данные не удалось прочитать.',true);}
  }
});

function navEntry(key,count=0){
  const [label,ic]=routes[key];
  return '<a class="nav-link'+(key===ui.page?' active':'')+'" href="#'+key+'" data-action="navigate" data-id="'+key+'"'+(key===ui.page?' aria-current="page"':'')+'>'+icon(ic,19)+'<span>'+label+'</span>'+(count?'<small>'+count+'</small>':'')+'</a>';
}
function shell(contents){
  const p=person();
  const taskCount=m.queue(state,{branch:ui.branch,assignee:mine(),status:'open'}).length;
  const themeIcon=ui.theme==='light'?'moon':'sun';
  const themeLabel=ui.theme==='light'?'Включить тёмную тему':'Включить светлую тему';
  return '<div class="layout"><aside class="sidebar'+(ui.mobileNav?' mobile-open':'')+'"><a href="#home" class="brand" data-action="navigate" data-id="home" aria-label="GLAMOUR, на главную">'+wordmark+'</a>'+
    '<div class="workspace"><span class="workspace-logo">'+icon('building',18)+'</span><span><strong>Сеть салонов</strong><small>GLAMOUR · Ижевск</small></span></div>'+
    '<nav aria-label="Разделы"><p class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p>'+navEntry('home')+navEntry('contacts',taskCount)+navEntry('clients')+
    (manager()?'<p class="nav-caption tools-caption">УПРАВЛЕНИЕ</p>'+navEntry('agent')+navEntry('import')+navEntry('settings'):'')+'</nav>'+
    '<div class="sidebar-foot">'+(demoMode?'<div class="demo"><span></span> Деморежим</div>':'')+
    '<button class="profile" type="button" data-action="profile" aria-label="'+(serverMode?'Мой аккаунт':'Сменить демопрофиль')+'">'+avatar(p.name,manager()?1:0)+
    '<span class="profile-text"><strong>'+s(p.name)+'</strong><small>'+s(p.role)+'</small></span>'+icon('chevron',16)+'</button></div></aside>'+
    (ui.mobileNav?'<button type="button" class="scrim" data-action="nav-toggle" aria-label="Закрыть меню"></button>':'')+
    '<div class="workarea"><header class="topbar"><div class="breadcrumb"><button type="button" class="icon-button menu-button" data-action="nav-toggle" aria-label="Открыть меню">'+icon('menu')+'</button><span class="breadcrumb-root">GLAMOUR CRM</span>'+icon('right',13)+'<strong>'+routes[ui.page][0]+'</strong></div><div class="top-actions">'+
    '<button type="button" class="global-search" data-action="quick-search" aria-label="Поиск клиента">'+icon('search',17)+'<span>Поиск клиента</span><kbd>Ctrl K</kbd></button>'+
    control('Филиал','<select id="branch-select" data-filter="branch">'+branchOpts(ui.branch,true)+'</select>','branch-select')+
    '<button class="icon-button" type="button" data-action="theme" title="'+themeLabel+'" aria-label="'+themeLabel+'">'+icon(themeIcon,19)+'</button></div></header><main id="main">'+contents+'</main></div></div>';
}
function heading(title,subtitle,actions=''){
  return '<section class="page-heading"><div><h1>'+s(title)+'</h1>'+(subtitle?'<p>'+s(subtitle)+'</p>':'')+'</div>'+(actions?'<div class="heading-actions">'+actions+'</div>':'')+'</section>';
}
function stat(name,value,detail,ic,tone,action=''){
  const info='<div class="stat-top">'+iconBox(ic,tone)+'<span>'+s(name)+'</span></div><strong>'+s(typeof value==='number'?m.number(value):value)+'</strong><small>'+s(detail)+'</small>';
  return action?'<button class="stat-card" data-action="'+action+'" type="button">'+info+'</button>':'<article class="stat-card">'+info+'</article>';
}
const categoryOptions=keys=>keys.map(key=>[key,reasonTitle(key)]);
const clientCategories=[...segmentKeys,'future','working','excluded','unknown','clear'];
const contactDraftFields=['result','followUp','followUpTime','paidAmount','paidDate','note'];
function scopedContactGroups(){
  const {rows}=auditView();
  const groups=contactGroups(state,{branch:ui.branch,assignee:mine(),amounts:new Map(rows.map(row=>[row.client.id,row.amount]))});
  groups.priority=rows.filter(row=>canStartReturn(row)&&(!ui.contactReason||row.reason===ui.contactReason))
    .map(({client})=>({clientId:client.id,assignee:defaultAssignee(client.branch)})).filter(row=>row.assignee);
  return groups;
}
function deskSelection(){
  const groups=scopedContactGroups();
  const rows=groups[ui.contactTab];
  const selected=rows.find(row=>row.clientId===ui.contactClient);
  if(selected)return {groups,rows,row:selected,index:rows.indexOf(selected)};
  const client=ui.contactPinned&&m.byClient(state,ui.contactClient);
  if(client&&(!ui.branch||ui.branch===client.branch)){
    const contact=groups.all.find(row=>row.clientId===client.id);
    return {groups,rows,row:contact??{clientId:client.id,assignee:mine()||defaultAssignee(client.branch)},index:-1};
  }
  return {groups,rows,row:rows[0],index:rows.length?0:-1};
}
function deskDraft(row){
  const key=[ui.profile,row.clientId,row.task?.id??''].join(':');
  if(!contactDrafts.has(key)){
    contactDrafts.set(key,{objection:'',topic:'',option:'',result:'',note:'',followUp:m.shiftDate(m.today(),1),followUpTime:'',
      paidAmount:'',paidDate:m.today(),requestId:m.newId()});
  }
  return {key,values:contactDrafts.get(key)};
}
function openContactDesk(id){
  if(!m.byClient(state,id)||contactSaving)return;
  const groups=scopedContactGroups();
  const tab=groups.priority.some(row=>row.clientId===id)?'priority':groups.ready.some(row=>row.clientId===id)?'ready':
    groups.followup.some(row=>row.clientId===id)?'followup':'all';
  go('contacts',{contactTab:tab,contactClient:id,contactPinned:tab==='all'&&!groups.all.some(row=>row.clientId===id)});
}
function deskFact(label,value){
  return '<div><dt>'+s(label)+'</dt><dd>'+s(value??'—')+'</dd></div>';
}
function deskHistory(client){
  const events=m.clientHistory(state,client).slice(0,6);
  return '<section class="panel desk-panel"><div class="panel-head"><h2>История клиента</h2>'+iconBox('clock','stone')+'</div>'+
    (events.length?'<ol class="desk-history">'+events.map(event=>{
      const label=event.kind==='call'?m.outcomes[event.result]:event.kind==='payment'?'Оплата · '+money(event.amount):event.title;
      const details=[event.assignee?m.byPerson(event.assignee)?.name:'',event.service||''].filter(Boolean);
      return '<li><span class="history-point"></span><div><div class="history-meta"><strong>'+s(label)+'</strong><time datetime="'+s(event.date)+'">'+s(m.formatDate(event.date))+'</time></div>'+
        (details.length?'<small>'+s(details.join(' · '))+'</small>':'')+(event.note?'<p>'+s(event.note)+'</p>':'')+'</div></li>';
    }).join('')+'</ol>':'<p class="desk-empty-history">Пока нет записей в истории.</p>')+'</section>';
}
function deskGuide(client,row,last,history){
  const waiting=Boolean(client.waitingForClientSince&&(last.lastVisit||'')<=client.waitingForClientSince);
  const followUp=!waiting&&row.task?.reason==='followup';
  const previous=followUp?history.find(event=>event.kind==='call'):null;
  const reason=waiting?'waiting':row.task?.originReason||m.retentionReason(state,client);
  const guide=contactBrief({client,reason,service:last.service,staffName:m.byPerson(row.assignee)?.name,previousResult:previous?.result,followUp});
  const previousText=previous?.note?.trim();
  const preview=previousText&&identifyObjection(previousText)!=='other'
    ?{label:'Замечание из прошлого звонка',text:previousText.slice(0,900)}
    :demoMode&&client.source==='demo'?{label:'Пример ответа в демо',text:guide.example}:null;
  return {...guide,preview,waiting};
}
const quickResults=[
  ['no_answer','Клиент не ответил','Укажите дату повторной попытки.'],
  ['contacted','Есть интерес','Зафиксируйте вопрос клиента и согласованную дату контакта.'],
  ['declined','Клиенту не актуально','Укажите причину, если она известна.'],
  ['client_will_call','Клиент свяжется сам','Завершите разговор без повторной задачи.'],
  ['do_not_contact','Просит больше не звонить','Сохраните результат, чтобы исключить клиента из обзвона.']
];
const callResults=[
  ['no_answer','phone','Не ответил'],
  ['callback','clock','Перезвонить'],
  ['contacted','target','Есть интерес'],
  ['paid','wallet','Оплатил']
];
const nextResultHelp={
  no_answer:'Выберите дату следующей попытки.',
  callback:'Укажите согласованные дату и время.',
  contacted:'Запишите, что заинтересовало клиента, и укажите дату следующего контакта.',
  thinking:'Укажите, когда договорились вернуться к разговору.',
  agreed:'Запишите договорённость и дату следующего контакта.',
  paid:'Укажите сумму и дату фактической оплаты.',
  declined:'Если известна причина отказа, добавьте её в комментарий.',
  client_will_call:'Повторная задача не создаётся. Клиент свяжется по своей инициативе.',
  invalid_number:'Карточка будет исключена из обзвона из-за неверного номера.',
  do_not_contact:'Карточка будет исключена из обзвона по просьбе клиента.'
};
function deskAgentSuggestion(client,draft,guide){
  const actual=draft.objection.trim();
  const preview=actual?null:guide.preview;
  if(!actual&&!preview)return '';
  const feedback=agentState(state).feedback;
  const suggestion=recommend(actual||preview.text,feedback,client.branch,draft.topic);
  const option=suggestion.options.find(item=>item.id===draft.option)||suggestion.options[0];
  const vote=feedback.find(item=>item.clientId===client.id&&item.objection===suggestion.key&&item.option===option.id);
  const extra='data-key="'+suggestion.key+'" data-option="'+option.id+'"';
  const sensitive=['stop','wrong','urgent'].includes(suggestion.key);
  return '<div class="agent-suggestion">'+(preview?'<p class="agent-example"><strong>'+s(preview.label)+'</strong><span>«'+s(preview.text)+'»</span></p>':'')+
    '<div class="agent-suggestion-head">'+(preview||sensitive?tag(suggestion.label,sensitive?'red':'berry'):
      '<label class="agent-select"><span>Ситуация</span><select id="agent-topic">'+
      opts(Object.entries(objections).map(([key,item])=>[key,item.label]),suggestion.key)+'</select></label>')+
    (suggestion.options.length>1?'<label class="agent-select"><span>Вариант ответа</span><select id="agent-option">'+
      opts(suggestion.options.map(item=>[item.id,item.title]),option.id)+'</select></label>':'')+'</div>'+
    '<div class="agent-response">'+(option.reply?'<h3>Что ответить</h3><blockquote>'+s(option.reply)+'</blockquote>':'')+
    '<h3>Что сделать</h3><p>'+s(option.step)+'</p></div>'+
    (preview?button('Клиент так ответил',null,'secondary small','agent-use-example'):
      (option.condition?'<p class="agent-condition">'+s(option.condition)+'</p>':'')+'<div class="agent-tools">'+
      (option.outcome?button('Выбрать «'+m.outcomes[option.outcome]+'»',null,'secondary small','agent-step','data-id="'+option.outcome+'" data-copy-objection'):'')+
      button(vote?.helpful===true?'Помогло ✓':'Помогло',null,'secondary small','agent-rate',extra+' data-helpful="true" aria-pressed="'+(vote?.helpful===true)+'"')+
      button(vote?.helpful===false?'Не помогло ✓':'Не помогло',null,'secondary small','agent-rate',extra+' data-helpful="false" aria-pressed="'+(vote?.helpful===false)+'"')+'</div>')+'</div>';
}
function deskAgentPanel(client,draft,guide){
  return '<section class="panel desk-panel desk-agent"><div class="panel-head"><h2>Подсказка агента</h2>'+iconBox('sparkle','berry')+'</div>'+
    '<div class="desk-agent-inner"><div class="agent-plan"><p><strong>С чего начать</strong><span>'+s(guide.opening)+'</span></p>'+
    '<p><strong>'+s(guide.waiting?'Если клиент обратился':'После согласия говорить')+'</strong><span>'+s(guide.question)+'</span></p>'+
    '<p><strong>Задача разговора</strong><span>'+s(guide.goal)+'</span></p></div>'+
    field('Что сказал клиент','<textarea rows="2" maxlength="900" id="agent-objection" placeholder="Например, ушла в другой салон">'+
      s(draft.objection)+'</textarea>')+'<div id="agent-suggestion" aria-live="polite">'+deskAgentSuggestion(client,draft,guide)+'</div>'+
    '<details class="agent-next-actions"><summary>Что выбрать после звонка</summary><ul>'+quickResults.map(([result,label,detail])=>
      '<li>'+button(label,null,'secondary small','agent-step','data-id="'+result+'"')+'<span>'+s(detail)+'</span></li>').join('')+'</ul></details>'+
    '</div></section>';
}
function deskClientCard(row,index,rows){
  const client=m.byClient(state,row.clientId);
  const record=deskDraft(row);
  const {values:draft}=record;
  const last=m.lastKnownVisit(state,client);
  const future=m.retentionReason(state,client)==='future';
  const excluded=client.callBlocked||client.invalidPhone;
  const history=m.clientHistory(state,client);
  const latest=history.find(event=>event.kind==='payment');
  const callable=!excluded&&!(!row.task&&future)&&Boolean(row.assignee&&client.phone);
  const reason=row.task?.originReason||row.task?.reason||m.retentionReason(state,client);
  const owner=m.byPerson(row.assignee)?.name;
  const estimate=auditView().rows.find(entry=>entry.client.id===client.id);
  const status=row.task?.status||'';
  const guide=callable?deskGuide(client,row,last,history):null;
  const when=row.due?[m.longDate(row.due),row.task?.dueTime].filter(Boolean).join(' · '):
    ui.contactTab==='priority'?'Без назначенной задачи':'Без срока';
  const canAdvance=index>=0&&rows.length>1;
  const fill=draft;
  const form='<form id="desk-contact-form" data-key="'+s(record.key)+'" data-client="'+s(client.id)+'" data-task="'+s(row.task?.id||'')+'">'+
    '<div class="call-outcomes" aria-label="Частые результаты">'+callResults.map(([result,ic,label])=>
      button(label,ic,'quick-outcome','pick-outcome','data-id="'+result+'" aria-pressed="'+(draft.result===result)+'"')).join('')+'</div>'+
    '<div class="desk-form form-grid">'+outcomeFields(fill)+
    '<p class="desk-result-tip wide" aria-live="polite" hidden></p>'+paymentFields(draft)+followUpFields(draft)+
    '<input type="hidden" name="requestId" value="'+s(draft.requestId)+'">'+
    '<input type="hidden" name="assignee" value="'+s(row.assignee)+'">'+
    field('Комментарий','<textarea name="note" maxlength="1200" rows="3" placeholder="Что обсудили и о чём договорились">'+s(draft.note)+'</textarea>','wide')+
    '<div class="form-error wide" role="alert" hidden></div></div>'+
    '<div class="desk-save"><button class="button primary" type="submit" name="advance" value="yes"'+(contactSaving?' disabled':'')+'>'+icon('check',17)+
    (canAdvance?'Сохранить и дальше':'Сохранить результат')+'</button>'+
    (canAdvance?'<button class="button secondary" type="submit" name="advance" value="no"'+(contactSaving?' disabled':'')+'>Сохранить без перехода</button>':'')+'</div></form>';
  return '<div class="desk-grid"><div class="desk-column"><section class="panel desk-panel desk-client"><div class="desk-client-head">'+clientAvatar(client)+
    '<div><h2 tabindex="-1" id="contact-desk-client">'+s(client.name)+'</h2><p>'+s(m.byBranch(client.branch)?.label)+'</p></div>'+
    (row.task?.priority==='high'?badge('high',priorities):'')+'</div>'+
    '<div class="desk-phone">'+icon('phone',19)+'<div><small>Телефон клиента</small><strong>'+s(m.formatPhone(client.phone))+'</strong></div>'+
    (client.phone?button('Копировать',null,'secondary small','copy-desk-phone','data-id="'+s(client.id)+'"'):'')+'</div>'+
    '<div class="desk-summary"><div class="desk-audit"><small>Потенциал одной покупки</small><strong>'+s(estimate?.amount!=null?money(estimate.amount):'Нет оценки')+'</strong>'+
    (estimate?.basis?'<span>'+s(priceLabels[estimate.basis])+'</span>':'')+'</div>'+
    '<div class="desk-reason"><div class="desk-kicker">Причина контакта</div><strong>'+s(reasonTitle(reason))+'</strong>'+
    (row.task?.title?'<p>'+s(row.task.title)+'</p>':'')+'</div></div>'+
    '<div class="desk-task-meta">'+icon('clock',14)+s(when)+(owner?'<span>'+s(owner)+'</span>':'')+(status?badge(status):'')+'</div>'+
    (row.task?.note?'<p class="desk-task-note">'+s(row.task.note)+'</p>':'')+'</section>'+
    (guide?deskAgentPanel(client,draft,guide):'')+'</div>'+
    '<aside class="desk-column"><section class="panel desk-panel desk-result"><div class="panel-head"><h2>Результат контакта</h2>'+iconBox('checkList','pink')+'</div>'+
    (callable?form:'<p class="desk-empty-agent">'+s(excluded?'Клиент исключён из контактов.':future?'У клиента есть будущая запись.':'Нет номера телефона или ответственного.')+'</p>')+'</section>'+
    '<section class="panel desk-panel"><div class="panel-head"><h2>О клиенте</h2>'+
    button('Полная карточка',null,'secondary small','client','data-id="'+s(client.id)+'"')+'</div>'+
    '<dl class="desk-facts">'+deskFact('Последний визит',last.lastVisit?m.longDate(last.lastVisit):'Нет данных')+
    deskFact('Визитов по выгрузке',client.visitCount)+deskFact('Последняя услуга',last.service||'—')+
    deskFact('Последняя отмена',m.longDate(client.lastCancellation))+
    deskFact('Сегмент',reasonTitle(m.retentionReason(state,client)))+'</dl>'+
    (latest?'<dl class="desk-money">'+deskFact('Последняя подтверждённая оплата',money(latest.amount))+'</dl>':'')+'</section>'+deskHistory(client)+'</aside></div>';
}
function contactDeskPage(){
  const {groups,rows,row,index}=deskSelection();
  const controlButton=(label,direction,disabled)=>button(label,null,'secondary small','desk-move',
    'data-id="'+direction+'"'+(disabled||contactSaving?' disabled':''));
  return heading('Очередь клиентов','',manager()?button('Назначить задачи','plus','secondary','batch'):'')+
    '<section class="panel desk-toolbar"><div class="desk-toolbar-tabs">'+tabs(Object.entries(queueTabs).map(([key,label])=>
      [key,label+' · '+m.number(groups[key].length)]),ui.contactTab,'desk-tab')+'</div><div class="desk-nav">'+
    controlButton('Предыдущий','prev',index<=0)+'<div class="desk-position" aria-live="polite">'+
    (index>=0?'<span><strong>'+m.number(index+1)+'</strong> из '+m.number(rows.length)+'</span><progress aria-label="Позиция в очереди" value="'+(index+1)+'" max="'+rows.length+'"></progress>':
      '<span>'+(row?'Отдельная карточка':'Очередь пуста')+'</span>')+'</div>'+
    controlButton('Следующий','next',index<0||index>=rows.length-1)+'</div></section>'+
    (ui.contactReason&&ui.contactTab==='priority'?'<div class="desk-filter-context">'+badge(ui.contactReason,reasons)+
      button('Показать все причины',null,'subtle small','desk-tab','data-id="priority"')+'</div>':'')+
    (row?deskClientCard(row,index,rows):'<section class="panel">'+empty('В этой очереди пока нет клиентов','Выберите другой фильтр или проверьте назначение задач.','phone')+'</section>');
}
function agentPage(){
  const config=agentState(state);
  const feedback=config.feedback.filter(vote=>!ui.branch||vote.branch===ui.branch);
  return heading('Агент','',button('Подготовить очередь','checkList','primary','run-agent'))+
    '<div class="agent-management"><section class="panel"><div class="panel-head"><div><h2>Автоматическое назначение</h2><p>Сначала клиенты с наибольшим потенциалом</p></div>'+
    tag(config.auto?'Включено':'Выключено',config.auto?'green':'slate')+'</div><form id="agent-settings-form"><div class="modal-body form-grid">'+
    '<label class="agent-check wide"><input type="checkbox" name="auto"'+(config.auto?' checked':'')+'>Автоматически назначать задачи после импорта</label>'+
    field('До задач на филиал в день',input('limit',config.limit,'number','required min="1" max="50"'))+
    '<p class="secondary-text wide">'+(serverMode?'Сервер также проверяет очередь каждые 15 минут.':'В демо агент запускается после импорта или кнопкой выше.')+'</p>'+
    '<div class="form-error wide" role="alert" hidden></div><button class="button secondary" type="submit">Сохранить</button></div></form></section>'+
    '<section class="panel"><div class="panel-head"><div><h2>Результаты агента</h2></div>'+iconBox('chart','berry')+'</div><div class="modal-body agent-run">'+
    '<div><strong>'+m.number(config.lastRun?.assigned??0)+'</strong><span>Задач в последнем запуске с назначениями</span></div>'+
    '<div><strong>'+m.number(feedback.filter(vote=>vote.helpful).length)+' из '+m.number(feedback.length)+'</strong><span>Отметок «Помогло»</span></div>'+
    (config.lastRun?'<ul>'+config.lastRun.branches.map(item=>'<li>'+s(m.byBranch(item.id)?.name||'Филиал')+' · '+m.number(item.assigned)+'</li>').join('')+'</ul>':'')+
    '</div></section></div>';
}

function selectDeskTab(id){
  if(contactSaving||!Object.hasOwn(queueTabs,id))return;
  ui.contactTab=id;
  ui.contactReason='';
  ui.contactPinned=false;
  ui.contactClient='';
  render();
  document.querySelector('[data-action="desk-tab"][aria-pressed="true"]')?.focus();
}
function moveDesk(direction){
  if(contactSaving)return;
  const {rows,index}=deskSelection();
  const next=rows[index+(direction==='prev'?-1:1)];
  if(index<0||!next)return;
  ui.contactClient=next.clientId;
  ui.contactPinned=false;
  render();
  document.querySelector('#contact-desk-client')?.focus();
}
async function copyDeskPhone(id){
  const client=m.byClient(state,id);
  if(!client?.phone)return;
  try{
    await navigator.clipboard.writeText('+'.concat(client.phone));
    notify('Телефон скопирован');
  }catch{notify('Выделите номер в карточке и скопируйте вручную.',true);}
}
function rememberDeskField(field){
  if(ui.page!=='contacts')return;
  const {row}=deskSelection();
  if(!row)return;
  if(field.id==='agent-objection'){
    const draft=deskDraft(row).values;
    draft.objection=field.value;
    draft.topic='';
    draft.option='';
    refreshAgentSuggestion();
  }else if(field.form?.id==='desk-contact-form'&&contactDraftFields.includes(field.name)){
    const draft=contactDrafts.get(field.form.dataset.key);
    if(draft)draft[field.name]=field.value;
  }
}
function refreshAgentSuggestion(){
  const panel=document.querySelector('#agent-suggestion');
  const {row}=deskSelection();
  if(panel&&row){
    const client=m.byClient(state,row.clientId);
    panel.innerHTML=deskAgentSuggestion(client,deskDraft(row).values,deskGuide(client,row,m.lastKnownVisit(state,client),m.clientHistory(state,client)));
  }
}
function useAgentExample(){
  const field=document.querySelector('#agent-objection');
  const {row}=deskSelection();
  if(!field||!row||contactSaving)return;
  const client=m.byClient(state,row.clientId);
  const guide=deskGuide(client,row,m.lastKnownVisit(state,client),m.clientHistory(state,client));
  if(!guide.preview)return;
  field.value=guide.preview.text;
  const draft=deskDraft(row).values;
  draft.objection=field.value;
  refreshAgentSuggestion();
  field.focus();
}
function applyAgentStep(result,copyObjection){
  const form=document.querySelector('#desk-contact-form');
  if(!form||!Object.hasOwn(m.outcomes,result)||contactSaving)return;
  form.elements.result.value=result;
  rememberDeskField(form.elements.result);
  if(copyObjection&&!form.elements.note.value.trim()){
    form.elements.note.value=document.querySelector('#agent-objection').value.trim();
    rememberDeskField(form.elements.note);
  }
  toggleOutcome(form);
  form.elements.result.focus();
  form.elements.result.scrollIntoView?.({block:'nearest'});
  notify('Результат выбран. Проверьте его перед сохранением.');
}
async function rateAgent(button){
  const {row}=deskSelection();
  if(!row||button.disabled)return;
  button.disabled=true;
  const {key,option,helpful}=button.dataset;
  try{
    await run({type:'agent-feedback',clientId:row.clientId,objection:key,option,helpful:helpful==='true'},{refresh:false});
    const current=ui.page==='contacts'&&deskSelection().row;
    if(current?.clientId===row.clientId){
      const draft=deskDraft(current).values;
      draft.option=helpful==='true'?option:'';
      refreshAgentSuggestion();
    }
    notify('Оценка сохранена');
  }catch(error){button.disabled=false;notify(error.message,true);}
}
async function saveDeskResult(event){
  if(contactSaving)return;
  const form=event.target;
  const {client,task,key}=form.dataset;
  const before=deskSelection();
  const {contactTab:tab,contactClient:selection,branch,profile}=ui;
  const data=Object.fromEntries(new FormData(form));
  const advance=event.submitter?.value!=='no'&&before.index>=0;
  contactSaving=true;
  for(const button of form.querySelectorAll('[type="submit"]'))button.disabled=true;
  try{
    await run({type:'record-contact',clientId:client,taskId:task,values:data},{refresh:false});
    contactDrafts.delete(key);
    contactSaving=false;
    if(ui.page==='contacts'&&ui.contactTab===tab&&ui.contactClient===selection&&ui.branch===branch&&ui.profile===profile){
      ui.contactClient=advance?nextContact(before.rows,client,scopedContactGroups()[tab]):client;
      ui.contactPinned=!advance;
    }
    render();
    if(ui.page==='contacts')document.querySelector('#contact-desk-client')?.focus();
    notify(data.result==='paid'?'Оплата подтверждена':terminalResults.has(data.result)?'Результат сохранён':
      'Повторный контакт: '+m.formatDate(data.followUp)+(data.followUpTime?' · '+data.followUpTime:''));
  }catch(error){
    contactSaving=false;
    const message=form.querySelector('.form-error');
    message.textContent=error.message;
    message.hidden=false;
    for(const button of form.querySelectorAll('[type="submit"]'))button.disabled=false;
  }
}
async function saveAgentSettings(form){
  const data=new FormData(form);
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;
  try{
    const {assigned}=await run({type:'agent-settings',auto:data.has('auto'),limit:Number(data.get('limit'))});
    notify(assigned?'Агент назначил задач: '+m.number(assigned):'Настройки агента сохранены');
  }catch(error){
    const message=form.querySelector('.form-error');
    message.textContent=error.message;
    message.hidden=false;
    submit.disabled=false;
  }
}
async function runAgentNow(button){
  if(!manager()||button.disabled)return;
  button.disabled=true;
  try{
    const {assigned}=await run({type:'agent-cycle',branch:ui.branch});
    notify(assigned?'Агент назначил задач: '+m.number(assigned):'Новых задач по правилам нет');
  }catch(error){button.disabled=false;notify(error.message,true);}
}

function auditView(period=ui.period,branch=ui.branch){
  const day=m.today();
  const key=[branch,day,period].join(':');
  if(!auditCache.has(key))auditCache.set(key,moneyAudit(state,{branch,day,period}));
  return auditCache.get(key);
}
const clientPlural=new Intl.PluralRules('ru');
const countClients=count=>m.number(count)+' '+({one:'клиент',few:'клиента',many:'клиентов',other:'клиентов'}[clientPlural.select(count)]);
function recoveryHero(ready,readyAmount){
  const title='Деньги в базе';
  const detail=ready.length?countClients(ready.length)+(ready.length===1?' готов к контакту':' готовы к контакту')+
    (readyAmount?' · потенциал '+money(readyAmount):''):
    'Проверьте результаты и текущие задачи по возврату клиентов.';
  const queueAction=ready.some(row=>defaultAssignee(row.client.branch))?
    button('Начать с приоритетных','right','hero-primary','start-returns'):
    button(manager()?'Открыть очередь':'Моя очередь','right','hero-primary','navigate','data-id="contacts"');
  return '<section class="recovery-hero" aria-labelledby="home-title"><div class="recovery-hero-content">'+
    '<p class="hero-scope">'+icon('pin',15)+s(ui.branch?m.byBranch(ui.branch)?.label:'Все филиалы')+'</p>'+
    '<h1 id="home-title">'+title+'</h1><p class="hero-detail">'+s(detail)+'</p>'+
    '<div class="hero-actions">'+queueAction+
    (manager()?button('Импортировать базу','upload','hero-secondary','navigate','data-id="import"'):'')+'</div></div>'+
    '<div class="hero-signature" aria-hidden="true">'+wordmark+'</div></section>';
}
const compactRubles=new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1});
const intervalLabel=range=>range.from===range.through?m.formatDate(range.from):
  m.formatDate(range.from)+' — '+m.formatDate(range.through);
function paymentChart(audit){
  const buckets=paymentBuckets(audit.recorded,m.today(),ui.period);
  const maximum=Math.max(...buckets.map(item=>item.amount));
  const scale=Math.max(1,Math.ceil(maximum/100000))*100000;
  const selected=buckets.find(item=>item.from===ui.payWindow);
  const periods='<div class="chart-periods" aria-label="Период оплат">'+paymentPeriods.map(days=>
    '<button type="button" data-action="pay-period" data-id="'+days+'" aria-pressed="'+(ui.period===days)+'" aria-label="'+days+' дней">'+days+' дн.</button>').join('')+'</div>';
  const chart='<div class="payment-chart"><div class="chart-axis" aria-hidden="true">'+[scale,scale/2,0].map(value=>
    '<span>'+s(compactRubles.format(value/100))+' ₽</span>').join('')+'</div>'+
    '<div class="chart-columns" style="--columns:'+buckets.length+'">'+buckets.map(({from,through,amount,count})=>{
      const label=intervalLabel({from,through});
      return '<button type="button" class="chart-column" data-action="pay-window" data-id="'+from+'" aria-pressed="'+(selected?.from===from)+
        '" aria-label="'+s(label+', '+money(amount)+', оплат: '+m.number(count))+'"><span class="chart-slot" aria-hidden="true">'+
        '<span class="chart-bar" style="--bar:'+Math.max(amount?2:0,100*amount/scale).toFixed(2)+'%"></span></span>'+
        '<span class="chart-label" aria-hidden="true">'+s(m.formatDate(through,{day:'numeric',month:'numeric'}))+'</span></button>';
    }).join('')+'</div></div>';
  return '<section class="panel revenue-panel"><div class="panel-head"><div><h2>Возвращённая выручка</h2><p>Подтверждённые оплаты</p></div>'+periods+'</div>'+
    '<div class="chart-summary"><span>'+s(money(selected?.amount??audit.confirmed))+'</span><small>'+s(selected?
      intervalLabel(selected)+' · оплат: '+m.number(selected.count):'Оплат за период: '+m.number(audit.recorded.length))+'</small></div>'+
    (audit.recorded.length?chart:'<div class="chart-empty">'+icon('chart',25)+'<span>За этот период оплат пока нет</span></div>')+
    '<div class="chart-footer">'+(selected?button('Весь период',null,'subtle small','pay-window'):
      '<span class="chart-legend"><i></i>Фактические суммы</span>')+
    button(selected?'Оплаты за эти даты':'Журнал оплат','right','subtle small','payment-log',selected?'data-id="'+selected.from+'"':'')+'</div></section>';
}
function moneyBreakdown(audit){
  const byCause=ui.moneyView==='reason';
  const peak=Math.max(1,...audit.groups.map(item=>item.amount));
  const branchFilter=ui.branch;
  const branches=m.branches.filter(branch=>!branchFilter||branch.id===branchFilter);
  const controls=tabs([['reason','Причины'],['branch','Филиалы']],ui.moneyView,'money-view');
  let content;
  if(byCause){
    content=audit.groups.length?'<div class="money-group-list">'+audit.groups.map(group=>
      '<button type="button" class="money-group" data-action="money-reason" data-id="'+s(group.reason)+'" aria-pressed="'+(ui.homeReason===group.reason)+'">'+
      '<span class="money-group-label"><strong>'+s(reasonTitle(group.reason))+'</strong><small>'+countClients(group.count)+
      (group.priced<group.count?' · с оценкой: '+m.number(group.priced):'')+'</small></span><strong>'+s(group.priced?money(group.amount):'—')+'</strong>'+
      '<span class="money-track" aria-hidden="true"><span style="width:'+(group.amount/peak*100).toFixed(2)+'%"></span></span></button>').join('')+
      '</div>':empty('Нет клиентов на возврат',audit.total?'Проверьте данные о последних визитах.':'Загрузите клиентскую базу.','users');
  }else{
    const totals=branchMoney(audit,branches,new Map(state.clients.map(client=>[client.id,client.branch])));
    content='<div class="money-branch-list"><div class="money-branch-head" aria-hidden="true"><span>Филиал</span><span>Потенциал</span><span>Оплачено</span></div>'+
      totals.map(group=>'<button class="money-branch-row" type="button" data-action="money-branch" data-id="'+s(group.branch.id)+'"'+
        ' aria-label="'+s(group.branch.name+', потенциал '+(group.priced?money(group.amount):'без оценки')+', подтверждено '+money(group.confirmed))+'">'+
        '<span><strong>'+s(group.branch.name)+'</strong><small>'+countClients(group.count)+'</small></span>'+
        '<b>'+s(group.priced?money(group.amount):'—')+'</b><b class="branch-confirmed">'+s(money(group.confirmed))+'</b></button>').join('')+'</div>';
  }
  return '<section class="panel money-segments"><div class="panel-head"><div><h2>Где можно вернуть деньги</h2><p>Оценка одной покупки на клиента</p></div>'+
    '</div><div class="breakdown-toolbar">'+controls+(branchFilter&&!byCause?button('Все филиалы',null,'subtle small','money-branch'):'')+'</div>'+
    content+'<div class="breakdown-footer"><span>Без суммы <b>'+m.number(audit.unknown)+'</b></span><span>Без даты визита <b>'+m.number(audit.unclassified)+
    '</b></span>'+(audit.estimated?'<span title="Медиана чеков по той же услуге и филиалу">По похожим клиентам <b>'+m.number(audit.estimated)+'</b></span>':'')+'</div></section>';
}
function home(){
  const audit=auditView();
  const priced=audit.rows.length-audit.unknown;
  const ready=audit.rows.filter(canStartReturn);
  const readyAmount=ready.reduce((sum,row)=>sum+(row.amount??0),0);
  const inProgress=audit.rows.filter(row=>row.working);
  const workingAmount=inProgress.reduce((sum,row)=>sum+(row.amount??0),0);
  const workingPriced=inProgress.some(row=>row.amount!==null);
  const list=audit.rows.filter(row=>(!ui.homeReason||row.reason===ui.homeReason)&&
    (ui.homeFilter==='all'||(ui.homeFilter==='working'?row.working:canStartReturn(row))));
  const filtered=ui.homeReason?reasonTitle(ui.homeReason):'Приоритетные клиенты';
  const currentAi=aiReport?.state===state&&aiReport.branch===ui.branch?aiReport:null;
  return recoveryHero(ready,readyAmount)+'<div class="money-kpis">'+
    stat('Потенциал возврата',priced?money(audit.open):'—',m.number(priced)+' из '+m.number(audit.rows.length)+' с известной оценкой','wallet','berry','money-all')+
    stat('Уже в работе',workingPriced?money(workingAmount):'—',countClients(inProgress.length)+' из общего потенциала','phone','pink','money-working')+
    stat('Подтверждённые оплаты',money(audit.confirmed),'Оплат: '+m.number(audit.recorded.length)+' · за '+ui.period+' дн.','check','mint','payment-log')+
    '</div><div class="money-panels">'+paymentChart(audit)+moneyBreakdown(audit)+'</div>'+
    '<section class="panel money-clients" id="money-clients"><div class="panel-head"><div><h2 tabindex="-1">'+s(filtered)+'</h2><p>Сначала клиенты с наибольшим потенциалом</p></div>'+
    '<div class="client-hero-actions">'+(ui.homeReason?button('Все сегменты',null,'secondary small','money-reason','data-id="'+s(ui.homeReason)+'"'):'')+
    (ui.homeReason&&ready.some(row=>defaultAssignee(row.client.branch)&&row.reason===ui.homeReason)?
      button('Начать с этого сегмента','right','primary small','start-returns','data-id="'+s(ui.homeReason)+'"'):'')+'</div></div>'+
    '<div class="toolbar">'+tabs([['ready','Можно связаться · '+m.number(ready.length)],['working','В работе · '+m.number(inProgress.length)],
      ['all','Весь список · '+m.number(audit.rows.length)]],ui.homeFilter,'home-filter')+'</div>'+
    (list.length?'<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Причина</th><th>Потенциал</th><th aria-label="Действия"></th></tr></thead><tbody>'+
    list.slice(0,ui.homeLimit).map(({client,reason,amount,basis,working,contactable,paused,waitingForClient})=>
      '<tr><td><button class="identity" type="button" data-action="desk-client" data-id="'+s(client.id)+'">'+clientAvatar(client)+'<span><strong>'+s(client.name)+'</strong><small>'+
      s(m.byBranch(client.branch)?.name||'')+'</small></span></button></td><td>'+badge(reason,reasons)+
      (working?'<small class="cell-note">В работе</small>':!contactable?'<small class="cell-note">Нет телефона для контакта</small>':
        waitingForClient?'<small class="cell-note">Клиент свяжется сам</small>':paused?'<small class="cell-note">Недавно связывались</small>':'')+'</td><td><strong class="nowrap">'+
      s(amount===null?'Нет оценки':money(amount))+'</strong>'+(basis?'<small class="cell-note">'+s(priceLabels[basis])+'</small>':'')+
      '</td><td class="row-end">'+button('Открыть','right','secondary small','desk-client','data-id="'+s(client.id)+'" aria-label="'+s('Открыть карточку клиента '+client.name)+'"')+'</td></tr>').join('')+
    '</tbody></table></div>':empty('Нет клиентов по этому фильтру','','users'))+
    footerCount(list.length,ui.homeLimit,'more-contacts')+'</section>'+
    (manager()&&aiAvailable?'<section class="panel money-ai-panel"><div class="panel-head"><h2>Рекомендации ИИ</h2>'+
      button(currentAi?.text?'Обновить':'Получить рекомендации','sparkle','secondary small','money-ai',currentAi?.pending?'disabled':'')+'</div>'+
      (currentAi?.pending?'<p role="status">ИИ анализирует результаты…</p>':currentAi?.text?'<p class="money-ai-text">'+s(currentAi.text)+'</p>':
        currentAi?.error?'<p role="alert">'+s(currentAi.error)+'</p>':'')+'</section>':'');
}
function paymentLog(from=''){
  const audit=auditView();
  const range=paymentBuckets(audit.recorded,m.today(),ui.period).find(bucket=>bucket.from===from);
  const payments=range?audit.recorded.filter(entry=>entry.date>=range.from&&entry.date<=range.through):audit.recorded;
  present(modalHead('Подтверждённые оплаты',range?intervalLabel(range):'')+'<div class="drawer-body">'+
    filterSelect('period','Период',paymentPeriods.map(days=>[String(days),'Последние '+days+' дней']),String(ui.period))+
    (range?button('Показать весь период',null,'subtle small','payment-log'):'')+
    '<div class="money-paid-total"><strong>'+s(money(range?.amount??audit.confirmed))+'</strong><small>Оплат: '+m.number(payments.length)+'</small></div>'+
    (payments.length?'<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Дата</th><th>Сумма</th><th>Ответственный</th></tr></thead><tbody>'+
      payments.map(entry=>'<tr><td><button type="button" class="task-title" data-action="client" data-id="'+s(entry.clientId)+'">'+s(m.byClient(state,entry.clientId)?.name)+'</button></td><td class="nowrap">'+
        s(m.formatDate(entry.date))+'</td><td class="nowrap">'+s(money(entry.amount))+'</td><td>'+s(m.byPerson(entry.assignee)?.name)+'</td></tr>').join('')+
      '</tbody></table></div>':empty('Подтверждённых оплат за период нет','','wallet'))+'</div>','payments');
}
async function analyzeMoney(){
  if(!aiAvailable||!manager())return;
  const current={branch:ui.branch,state,pending:true};
  aiReport=current;
  if(ui.page==='home')render();
  try{current.text=(await repository.analyze({branch:current.branch})).analysis;}
  catch(error){current.error=error.message;}
  current.pending=false;
  if(ui.page==='home'&&aiReport===current)render();
}

function restoreSelection(action,id){
  const element=[...document.querySelectorAll('[data-action="'+action+'"]')].find(button=>button.dataset.id===id);
  element?.focus();
  return element;
}

function searchInput(placeholder){
  return '<label class="search"><span class="sr-only">'+s(placeholder)+'</span>'+icon('search',18)+'<input type="text" inputmode="search" id="query" data-filter="query" value="'+s(ui.query)+'" placeholder="'+s(placeholder)+'" autocomplete="off"></label>';
}
function filterSelect(key,label,list,value){
  return control(label,'<select data-filter="'+key+'" id="filter-'+key+'">'+opts(list,value)+'</select>');
}
function tabs(values,current,action){
  return '<div class="tabs" aria-label="Фильтр статусов">'+values.map(([key,label])=>'<button type="button" class="'+(key===current?'selected':'')+'" aria-pressed="'+(key===current)+'" data-action="'+action+'" data-id="'+key+'">'+s(label)+'</button>').join('')+'</div>';
}
function footerCount(total,limit,action){
  return '<div class="table-footer"><span>Показано '+m.number(Math.min(total,limit))+' из '+m.number(total)+'</span>'+
    (total>limit?button('Показать ещё',null,'secondary small',action):'')+'</div>';
}
function clientsPage(){
  const audit=new Map(auditView().rows.map(row=>[row.client.id,row]));
  let list=state.clients.filter(c=>(!ui.branch||c.branch===ui.branch)&&m.matches(c,ui.query)
    &&(!ui.segment||(ui.segment==='focus'?audit.has(c.id):
      ui.segment==='working'?m.displayedReason(state,c)==='working':m.retentionReason(state,c)===ui.segment)));
  list=list.map(client=>({...client,...m.lastKnownVisit(state,client)}));
  list.sort((a,b)=>ui.clientSort==='name'?a.name.localeCompare(b.name,'ru'):
    (ui.clientSort==='money'?(audit.get(b.id)?.amount??0)-(audit.get(a.id)?.amount??0):0)||(a.lastVisit||'9999').localeCompare(b.lastVisit||'9999')||a.name.localeCompare(b.name,'ru'));
  const items=list.slice(0,ui.clientLimit).map(c=>{
    const amount=audit.get(c.id)?.amount;
    const gap=c.lastVisit?m.dateDiff(m.today(),c.lastVisit):null;
    return '<tr><td><button class="identity" type="button" data-action="desk-client" data-id="'+s(c.id)+'">'+clientAvatar(c)+'<span><strong>'+s(c.name)+'</strong><small>'+s(m.formatPhone(c.phone))+'</small></span></button></td>'+
      '<td>'+s(m.byBranch(c.branch).name)+'</td><td>'+s(c.lastVisit?m.longDate(c.lastVisit):'Нет данных')+(gap!==null?'<small class="cell-note">'+m.number(gap)+' дн. назад</small>':'')+'</td><td>'+badge(m.retentionReason(state,c),reasons)+
      (m.displayedReason(state,c)==='working'?'<small class="cell-note">Уже в работе</small>':'')+'</td><td>'+s(money(amount))+'</td>'+
      '<td class="row-end"><button class="row-button" type="button" data-action="client" data-id="'+s(c.id)+'" aria-label="'+s('Открыть карточку '+c.name)+'">'+icon('right',16)+'</button></td></tr>';
  }).join('');
  return heading('Клиенты','',button('Работа с клиентами','phone','primary','navigate','data-id="contacts"')+
    (manager()?button('Импорт данных','upload','secondary','navigate','data-id="import"')+button('Назначить задачи','plus','secondary','batch'):''))+
    '<section class="panel"><div class="toolbar">'+searchInput('Поиск по имени или телефону')+
    filterSelect('segment','Сегмент клиентов',[['','Все сегменты'],['focus','Требуют внимания'],...categoryOptions(clientCategories)],ui.segment)+
    filterSelect('clientSort','Порядок сортировки',[['money','По потенциалу'],['attention','По давности визита'],['name','По имени']],ui.clientSort)+'</div>'+
    (list.length?'<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Филиал</th><th>Последний визит</th><th>Сегмент</th><th>Потенциал</th><th aria-label="Действия"></th></tr></thead><tbody>'+items+'</tbody></table></div>':
    empty('Клиенты не найдены','Попробуйте изменить поиск или фильтры.','users'))+footerCount(list.length,ui.clientLimit,'more-clients')+'</section>';
}
function settingsPage(){
  const cfg=m.settingsFor(state);
  return heading('Настройки','')+'<form id="settings-form" class="settings-grid">'+
    '<section class="panel"><div class="panel-head"><h2>Сегментация и задачи</h2></div><div class="modal-body form-grid">'+
    Object.entries(rulesFields).map(([key,[label,,min,max]])=>field(label,input(key,cfg.rules[key],'number','required min="'+min+'" max="'+max+'"'))).join('')+
    '</div></section><section class="panel"><div class="panel-head"><h2>Филиалы</h2></div><div class="modal-body form-grid">'+
    cfg.branches.map(branch=>field(branch.label,input('branch-'+branch.id,branch.name,'text','required maxlength="80"'),'wide')).join('')+
    field('Новый филиал',input('newBranch','','text','maxlength="80"'),'wide')+
    '</div></section><section class="panel settings-users"><div class="panel-head"><h2>Пользователи и филиалы</h2></div><div class="modal-body">'+
    cfg.users.map(user=>user.id!=='manager'?
      '<fieldset class="user-settings"><legend>'+s(user.role)+' · '+s(user.id)+'</legend>'+
      '<div class="form-grid">'+field('Имя',input('user-'+user.id,user.name,'text','required maxlength="120"'))+
      field('Роль',select('role-'+user.id,[['admin','Администратор'],['manager','Руководитель']],user.branch?'admin':'manager',true))+'</div>'+
      '<div class="branch-checks">'+cfg.branches.map(branch=>'<label><input type="checkbox" name="access-'+s(user.id)+'" value="'+s(branch.id)+'"'+
        (m.assignedBranches(user).includes(branch.id)?' checked':'')+'>'+s(branch.name)+'</label>').join('')+'</div></fieldset>':
      '<p class="secondary-text settings-manager">'+s(user.name)+' · '+s(user.role)+' · все филиалы</p>').join('')+
    '</div></section><div class="settings-save"><p id="settings-error" class="form-error" role="alert" hidden></p>'+
    '<button type="submit" class="button primary">'+icon('check',17)+'Сохранить настройки</button>'+
    (demoMode?button('Сбросить демоданные',null,'secondary','reset-demo'):'')+'</div></form>';
}
function renderLogin(error=''){
  document.title='GLAMOUR CRM — Вход';
  app.innerHTML='<main class="login-page"><form id="login-form" class="panel login-card"><div class="panel-head"><div>'+wordmark+
    '<h1>Вход в GLAMOUR CRM</h1></div></div><div class="modal-body form-grid">'+
    field('Логин',input('user','','text','required autocomplete="username" autofocus'),'wide')+
    field('Пароль',input('password','','password','required autocomplete="current-password"'),'wide')+
    (demoMode?'<p class="secondary-text wide">Руководитель: manager. Администраторы: alina, maria, sofia. Пароль демо: glamour-demo.</p>':'')+
    '<p id="login-error" class="form-error wide" role="alert"'+(error?'':' hidden')+'>'+s(error)+'</p>'+
    '<button type="submit" class="button primary wide">Войти</button></div></form></main>';
}
async function logout(){
  try{await repository.logout();contactDrafts.clear();account=null;closeModal();renderLogin();}
  catch(error){notify(error.message,true);}
}
async function submitMain(event){
  const form=event.target;
  if(!['login-form','settings-form'].includes(form.id))return;
  event.preventDefault();
  const data=new FormData(form);
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;
  try{
    if(form.id==='login-form'){
      const login=await repository.login(Object.fromEntries(data));
      account=login.user;
      ui.profile=account.id;
      ui.branch='';
      useSnapshot(await repository.read());
      aiAvailable=Boolean(login.ai);
      go(manager()?'home':'contacts');
    }else{
      const cfg=m.settingsFor(state);
      const rules=Object.fromEntries(Object.keys(rulesFields).map(key=>[key,data.get(key)]));
      const branches=Object.fromEntries(cfg.branches.map(branch=>[branch.id,data.get('branch-'+branch.id)]));
      const users=Object.fromEntries(cfg.users.filter(user=>user.id!=='manager').map(user=>
        [user.id,{name:data.get('user-'+user.id),role:data.get('role-'+user.id),branches:data.getAll('access-'+user.id)}]));
      await run({type:'save-settings',values:{rules,branches,users,newBranch:data.get('newBranch')}});
      notify('Настройки сохранены');
    }
  }catch(error){
    const message=form.querySelector('.form-error');
    message.textContent=error.message;
    message.hidden=false;
    submit.disabled=false;
  }
}

function mappingPanel(){
  const layout=ui.importLayout;
  if(!layout)return '';
  return '<details class="panel mapping-panel" '+(!Number.isInteger(ui.importMapping.name)?'open':'')+'><summary>Сопоставление столбцов</summary>'+
    '<div class="mapping-grid">'+Object.entries(fieldLabels).map(([key,label])=>field(label,
      '<span class="select-control"><select id="mapping-'+key+'" data-map="'+key+'">'+
      opts([['','Выберите столбец'],...layout.headers.map((header,index)=>[String(index),header||'Столбец '+(index+1)])],String(ui.importMapping[key]??''))+
      '</select>'+icon('chevron',15)+'</span>')).join('')+'</div></details>';
}
function importPage(){
  const file=ui.importFile;
  const result=ui.importPreview;
  let preview='';
  if(result){
    const examples=result.examples.slice(0,8);
    preview='<section class="panel import-preview"><div class="panel-head"><div><h2>Предпросмотр импорта</h2><p>'+s(file.name)+(file.sheet?' · Лист «'+s(file.sheet)+'»':'')+'</p></div></div><div class="import-counters">'+
      tag(m.number(result.added)+' новых','green')+tag(m.number(result.updated)+' к обновлению','berry')+
      tag(m.number(result.duplicates)+' без изменений или дублей','slate')+tag(m.number(result.issues.length)+' с ошибками',result.issues.length?'red':'slate')+'</div>'+
      (examples.length?'<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Филиал</th><th>Последний визит</th><th>Сумма из файла</th><th>Действие</th></tr></thead><tbody>'+
      examples.map(c=>'<tr><td><strong>'+s(c.name)+'</strong><small class="cell-note">'+s(m.formatPhone(c.phone))+'</small></td><td>'+s(m.byBranch(c.branch).name)+
        '</td><td>'+s(c.lastVisit?m.longDate(c.lastVisit):'Нет данных')+'</td><td>'+s(money(c.meanCheck??c.lastPaid??c.lifetimePaid))+'</td><td>'+s(c.operation)+'</td></tr>').join('')+
      '</tbody></table></div>':empty('Новых данных для сохранения нет','','file'))+
      (result.issues.length?'<details class="import-issues" open><summary>Ошибки в строках</summary><ul>'+result.issues.slice(0,20).map(issue=>'<li>Строка '+issue.row+' · '+s(issue.reason)+'</li>').join('')+'</ul>'+
      (result.issues.length>20?'<p>Показано 20 из '+result.issues.length+' ошибок.</p>':'')+'</details>':'')+
      '<div class="table-footer"><span>Ошибки и дубли пропускаются. История контактов сохраняется.</span>'+
      button('Загрузить и проанализировать','check','primary','commit-import',!result.records.length||ui.importBusy?'disabled':'')+'</div></section>';
  }
  return heading('Импорт данных','',button('Тестовый CSV','download','secondary','template'))+
    '<section class="panel import-box"><div class="panel-head"><div><h2>Загрузка файла</h2><p>CSV, XLSX или XLS · до 15 МБ</p><p>Для расчёта добавьте средний чек, последнюю оплату или сумму оплат и число визитов.</p></div>'+iconBox('upload','berry')+'</div><div class="import-body">'+
    (demoMode?'<div class="hint import-demo">Для демо используйте только вымышленные данные. Пример номера: +7 (000) 000-04-01.</div>':'')+
    '<div class="dropzone" id="dropzone"><input id="import-file" type="file" class="sr-only" accept=".csv,.xlsx,.xls" tabindex="-1">'+iconBox(file?'file':'upload','berry')+
    '<strong>'+s(file?.name||'Перетащите файл сюда')+'</strong><p>'+s(ui.importBusy?'Обработка файла…':'или выберите файл на устройстве')+'</p>'+
    button(file?'Заменить файл':'Выбрать файл',null,'secondary','pick-file',ui.importBusy?'disabled':'')+'</div>'+
    '<label class="field"><span>Филиал для строк без филиала</span><span class="select-control"><select id="fallback" data-filter="fallback">'+branchOpts(ui.fallback,false)+'</select>'+icon('chevron',15)+'</span></label>'+
    (ui.importError?'<div role="alert" class="form-error">'+s(ui.importError)+'</div>':'')+'</div></section>'+
    mappingPanel()+preview+
    (state.imports.length?'<section class="panel import-preview"><div class="panel-head"><div><h2>История импорта</h2></div></div><div class="table-wrap"><table><thead><tr><th>Файл</th><th>Дата</th><th>Добавлено</th><th>Обновлено</th></tr></thead><tbody>'+
    state.imports.slice(0,10).map(x=>'<tr><td>'+s(x.name)+'</td><td>'+s(m.longDate(x.date))+'</td><td>'+m.number(x.added)+'</td><td>'+m.number(x.updated??0)+'</td></tr>').join('')+'</tbody></table></div></section>':'');
}

const views={home,contacts:contactDeskPage,agent:agentPage,clients:clientsPage,import:importPage,settings:settingsPage};
function render(preserveFocus=false){
  const focused=preserveFocus&&document.activeElement?.id;
  const caret=focused==='query'?document.activeElement.selectionStart:null;
  if(serverMode&&!account){renderLogin();return;}
  if(managerPages.has(ui.page)&&!manager())ui.page='home';
  app.innerHTML=shell(views[ui.page]());
  if(ui.page==='contacts')toggleOutcome(document.querySelector('#desk-contact-form'));
  document.title='GLAMOUR CRM — '+routes[ui.page][0];
  if(focused){
    const field=document.getElementById(focused);
    field?.focus({preventScroll:true});
    if(caret!==null&&typeof field?.setSelectionRange==='function') field.setSelectionRange(caret,caret);
  }
}
const closeModal=()=>dialog.close();
function present(contents,type,data={}){
  modal={type,...data};
  dialog.className=type==='client'?'drawer':'';
  dialog.setAttribute('aria-labelledby','dialog-title');
  dialog.innerHTML=contents;
  if(!dialog.open) dialog.showModal();
  dialog.querySelector('[autofocus]')?.focus();
}
function modalHead(title,subtitle=''){
  return '<div class="modal-head"><div><h2 id="dialog-title">'+s(title)+'</h2>'+(subtitle?'<p>'+s(subtitle)+'</p>':'')+'</div><button type="button" class="icon-button" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button></div>';
}
const field=(label,element,css='')=>'<label class="field '+css+'"><span>'+s(label)+'</span>'+element+'</label>';
const select=(name,items,value,required=false)=>'<span class="select-control"><select name="'+name+'"'+(required?' required':'')+'>'+opts(items,value)+'</select>'+icon('chevron',15)+'</span>';
const input=(name,value,type='text',extra='')=>'<input name="'+name+'" type="'+type+'" value="'+s(value)+'" '+extra+'>';
function modalFoot(label,ic='check'){
  return '<div class="modal-foot">'+button('Отмена',null,'secondary','close')+'<button type="submit" class="button primary">'+icon(ic,17)+s(label)+'</button></div>';
}
function profileModal(){
  if(serverMode){
    present(modalHead('Аккаунт',person().name)+'<div class="modal-body">'+button('Выйти',null,'secondary','logout')+'</div>','account');
    return;
  }
  present(modalHead('Демопрофиль','Выберите кабинет администратора или руководителя.')+'<div class="profile-list">'+m.settingsFor(rawState).users.map((p,index)=>
    '<button type="button" data-action="switch-profile" data-id="'+p.id+'" class="profile-option">'+avatar(p.name,index)+'<span><strong>'+s(p.name)+'</strong><small>'+s(p.role)+(p.branch?' · '+s(m.byBranch(p.branch,rawState)?.name||''):' · Вся сеть')+'</small></span>'+(p.id===ui.profile?icon('check',20):'')+'</button>'
  ).join('')+'</div>','profile');
}
function clientModal(id){
  const c=m.byClient(state,id);
  if(!c)return;
  const visits=m.clientHistory(state,c);
  const last=m.lastKnownVisit(state,c);
  const tasks=state.tasks.filter(task=>task.clientId===id&&task.status!=='done').sort((a,b)=>a.due.localeCompare(b.due));
  present(modalHead('Карточка клиента')+'<div class="drawer-body"><div class="client-profile">'+clientAvatar(c)+'<div><h3>'+s(c.name)+'</h3><p>'+s(m.byBranch(c.branch).label)+'</p></div>'+badge(m.retentionReason(state,c),reasons)+'</div><div class="client-actions">'+
    (c.callBlocked||c.invalidPhone?'':button('Открыть в очереди','phone','primary','desk-client','data-id="'+s(id)+'"')+
    button('Новая задача','plus','secondary','new-task','data-id="'+s(id)+'"'))+
    ((mine()||defaultAssignee(c.branch))?button('Подтвердить оплату','wallet','secondary','confirm-payment','data-id="'+s(id)+'"'):'')+'</div>'+
    '<dl class="client-facts"><div><dt>Телефон</dt><dd>'+s(m.formatPhone(c.phone))+'</dd></div><div><dt>Последний визит</dt><dd>'+s(last.lastVisit?m.longDate(last.lastVisit):'Нет данных')+'</dd></div><div><dt>Дата регистрации</dt><dd>'+s(m.longDate(c.registered))+'</dd></div><div><dt>Последняя услуга</dt><dd>'+s(last.service||'—')+'</dd></div><div><dt>Завершённых визитов по выгрузке</dt><dd>'+s(c.visitCount??'—')+'</dd></div>'+
    '<div><dt>Последняя отмена</dt><dd>'+s(m.longDate(c.lastCancellation))+'</dd></div>'+
    '<div><dt>Отмен по выгрузке</dt><dd>'+s(c.cancelCount??'—')+'</dd></div></dl>'+
    (c.callBlocked||c.invalidPhone?'<div class="hint"><span>'+s(c.callBlocked?'Клиент просит больше не связываться.':'Телефон отмечен как неактуальный.')+'</span></div>':'')+
    '<section class="drawer-section"><h3>История взаимодействий</h3>'+
    (visits.length?'<div class="timeline">'+visits.map(event=>'<article>'+iconBox(typeIcon[event.kind]||'file',event.kind==='call'?'berry':'stone')+'<div><strong>'+s(event.kind==='call'?m.outcomes[event.result]:event.kind==='payment'?'Оплата · '+money(event.amount):event.title)+'</strong><small>'+s(m.longDate(event.date))+(event.assignee?' · '+s(m.byPerson(event.assignee)?.name||''):'')+'</small>'+
    (event.note?'<p>'+s(event.note)+'</p>':'')+(event.kind==='payment'&&event.service?'<p>'+s(event.service)+'</p>':'')+'</div></article>').join('')+'</div>':
    '<p class="secondary-text">Пока нет записей в истории.</p>')+'</section>'+
    (tasks.length?'<section class="drawer-section"><h3>Открытые задачи</h3>'+tasks.map(task=>'<div class="drawer-line">'+iconBox('checkList','berry')+'<div><button type="button" class="task-title" data-action="edit-task" data-id="'+s(task.id)+'">'+s(task.title)+'</button><small>'+s(m.byPerson(task.assignee)?.name)+' · '+s(m.longDate(task.due))+'</small></div>'+badge(task.status)+'</div>').join('')+'</section>':'')+'</div>','client',{id});
}
function outcomeFields(data={},inTask=false){
  const options=[['','Выберите результат'],...Object.entries(m.outcomes).filter(([key])=>
    (key!=='booked'&&(!inTask||key!=='paid'))||key===data.result)];
  return '<div class="result-fields">'+field('Результат контакта',select('result',options,data.result||'',true))+'</div>';
}
function paymentFields(data={},hidden=true){
  return '<div class="field-group" data-payment'+(hidden?' hidden':'')+'>'+
    field('Фактическая оплата, ₽',input('paidAmount',data.paidAmount||'','text','required inputmode="decimal" maxlength="20" placeholder="Например, 2 450"'))+
    field('Дата оплаты',input('paidDate',data.paidDate||m.today(),'date','required max="'+m.today()+'"'))+'</div>';
}
function taskModal(id='',clientId=''){
  const task=state.tasks.find(item=>item.id===id);
  const client=m.byClient(state,task?.clientId||clientId);
  const available=state.clients.filter(c=>!ui.branch||c.branch===ui.branch||c.id===client?.id)
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const preferred=mine()||defaultAssignee(client?.branch||ui.branch)||assignees()[0]?.id;
  const d=task??{clientId,title:'',assignee:preferred,due:m.today(),status:'new',note:''};
  present(modalHead(task?'Задача':'Новая задача',task?s(client.name):'Назначьте следующий контакт с клиентом.')+
    '<form id="task-form"><div class="modal-body form-grid">'+
    (task?'<input type="hidden" name="clientId" value="'+s(task.clientId)+'">':
      field('Клиент',select('clientId',[['','Выберите клиента'],...available.filter(c=>!c.callBlocked&&!c.invalidPhone).map(c=>[c.id,c.name+' · '+m.byBranch(c.branch).name])],d.clientId,true),'wide'))+
    field('Название задачи',input('title',d.title,'text','required maxlength="140" placeholder="Например, уточнить, почему клиент не вернулся" autofocus'),'wide')+
    field('Ответственный',select('assignee',assignees().map(p=>[p.id,p.name]),d.assignee,true))+
    field('Срок выполнения',input('due',d.due,'date','required'))+
    field('Время задачи',input('dueTime',d.dueTime||'','time'))+
    field('Приоритет',select('priority',Object.entries(priorities).map(([key,value])=>[key,value.label]),d.priority||'normal',true))+
    (task?'<p class="secondary-text wide">Причина: '+s(reasonTitle(task.reason))+'</p>':'')+
    field('Статус',select('status',Object.entries(m.statuses).map(([key,value])=>[key,value.label]),d.status,true),'wide')+
    outcomeFields(d,true)+followUpFields()+field('Комментарий','<textarea name="note" maxlength="1200" rows="3" placeholder="Детали для следующего контакта">'+s(d.note)+'</textarea>','wide')+
    (task?.activity?.length?'<details class="wide activity"><summary>История задачи</summary><ul>'+task.activity.slice().reverse().slice(0,20).map(event=>
      '<li>'+s(m.formatDate(event.date))+' · '+s(event.title)+(event.actor?' · '+s(m.byPerson(event.actor)?.name||event.actor):'')+'</li>').join('')+'</ul></details>':'')+
    '<div class="form-error wide" role="alert" hidden></div></div>'+modalFoot(task?'Сохранить задачу':'Создать задачу',task?'check':'plus')+'</form>','task',{id,clientId,appointment:task?.appointment,service:task?.service});
  toggleOutcome();
}
function followUpFields(data={}){
  const day=m.today();
  return '<div class="field-group" data-follow-up hidden>'+
    field('Следующий контакт',input('followUp',data.followUp||m.shiftDate(day,1),'date','min="'+day+'" required'))+
    field('Время повторного звонка',input('followUpTime',data.followUpTime||'','time'))+'</div>';
}
function confirmPayment(id){
  const client=m.byClient(state,id);
  const preferred=client&&(mine()||defaultAssignee(client.branch));
  if(!preferred)return;
  const staff=assignees().filter(person=>m.assignedBranches(person).includes(client.branch));
  present(modalHead('Подтверждение оплаты',client.name)+'<form id="payment-form"><div class="modal-body form-grid">'+
    '<input type="hidden" name="result" value="paid"><input type="hidden" name="requestId" value="'+s(m.newId())+'">'+
    paymentFields({},false)+
    field('Ответственный',select('assignee',staff.map(person=>[person.id,person.name]),preferred,true),'wide')+
    field('Комментарий','<textarea name="note" maxlength="1200" rows="2"></textarea>','wide')+
    '<div class="form-error wide" role="alert" hidden></div></div>'+modalFoot('Подтвердить оплату')+'</form>','payment',{id});
}
function batchModal(){
  const branch=ui.branch||person().branch||m.branches[0].id;
  const assignee=defaultAssignee(branch);
  const day=m.today();
  present(modalHead('Назначить задачи')+'<form id="batch-form"><div class="modal-body form-grid">'+
    field('Филиал',select('branch',m.branches.map(b=>[b.id,b.label]),branch,true))+
    field('Ответственный','<span class="select-control"><select name="assignee" required></select>'+icon('chevron',15)+'</span>')+
    field('Клиенты',select('group',[['focus','Все, кто требует внимания'],...categoryOptions(segmentKeys)],'focus',true),'wide')+
    field('Максимум задач',select('count',[['10','10'],['25','25'],['50','50']],'10',true))+
    field('Срок',input('due',m.shiftDate(day,m.settingsFor(state).rules.taskDays),'date','required min="'+day+'"'))+
    '<output class="batch-summary wide" id="batch-count" role="status"></output><div class="form-error wide" role="alert" hidden></div>'+
    '</div>'+modalFoot('Назначить задачи','plus')+'</form>','batch');
  dialog.querySelector('#batch-form').elements.assignee.value=assignee||'';
  batchPreview();
}
function batchPreview(){
  const form=dialog.querySelector('#batch-form');
  const {branch,group,count,assignee}=form.elements;
  assignee.innerHTML=opts(assignees().filter(p=>m.assignedBranches(p).includes(branch.value)).map(p=>[p.id,p.name]),assignee.value);
  const size=Math.min(Number(count.value),auditView(ui.period,branch.value).rows.filter(row=>row.contactable&&!row.working&&!row.paused&&(group.value==='focus'||row.reason===group.value)).length);
  form.querySelector('#batch-count').textContent='Будет назначено задач: '+m.number(size);
  form.querySelector('[type="submit"]').disabled=!size||!assignee.value;
}
function quickSearch(){
  present(modalHead('Поиск клиента')+
    '<form id="quick-search-form"><div class="modal-body">'+
    field('Имя или телефон',input('lookup','','search','id="quick-query" placeholder="Введите имя или номер" autocomplete="off" autofocus'))+
    '<div id="client-search-results" class="lookup-list"></div></div></form>','search');
  updateQuickSearch();
}
function updateQuickSearch(){
  const query=dialog.querySelector('#quick-query').value.trim();
  const list=query?state.clients.filter(client=>(!ui.branch||client.branch===ui.branch)&&m.matches(client,query)).slice(0,8):[];
  dialog.querySelector('#client-search-results').innerHTML=list.map(c=>
    '<button type="button" class="profile-option" data-action="client" data-id="'+s(c.id)+'">'+clientAvatar(c)+
    '<span><strong>'+s(c.name)+'</strong><small>'+s(m.byBranch(c.branch).name)+' · '+s(m.formatPhone(c.phone))+'</small></span></button>'
  ).join('')||(query?'<p class="secondary-text">Клиенты не найдены</p>':'');
}

function toggleOutcome(form=dialog.querySelector('form')){
  if(!form) return;
  const status=form.elements.namedItem('status');
  const result=form.elements.namedItem('result');
  const selected=!status||status.value==='done';
  const tip=form.querySelector('.desk-result-tip');
  if(tip){
    for(const shortcut of form.querySelectorAll('.quick-outcome'))shortcut.setAttribute('aria-pressed',String(shortcut.dataset.id===result.value));
    tip.textContent=nextResultHelp[result.value]??'';
    tip.hidden=!tip.textContent;
  }
  const payment=form.querySelector('[data-payment]');
  form.querySelector('.result-fields').hidden=!selected;
  result.disabled=!selected;
  if(payment){
    payment.hidden=!selected||result.value!=='paid';
    for(const field of payment.querySelectorAll('input'))field.disabled=payment.hidden;
  }
  const next=form.querySelector('[data-follow-up]');
  if(next){
    const historical=form.id==='task-form'&&modal?.type==='task'&&state.tasks.some(task=>task.id===modal.id&&task.status==='done'&&task.result===result.value);
    next.hidden=!selected||!result.value||terminalResults.has(result.value)||historical;
    form.elements.followUp.disabled=next.hidden;
    form.elements.followUpTime.disabled=next.hidden;
    form.elements.followUpTime.required=!next.hidden&&result.value==='callback';
  }
}

function updatePreview(){
  ui.importPreview=null;
  ui.importError='';
  if(!ui.importFile)return;
  try {ui.importPreview=previewRows(ui.importFile.rows,state.clients,ui.fallback,{...ui.importFile,mapping:ui.importMapping,branches:m.branches,demoOnly:demoMode});}
  catch(err){ui.importError=err.message;}
}
async function handleFile(file){
  if(!file||ui.importBusy)return;
  ui.importBusy=true;ui.importError='';ui.importFile=null;ui.importLayout=null;ui.importMapping=null;ui.importPreview=null;
  render();
  try{
    const data=await readFile(file);
    ui.importLayout=detectColumns(data.rows);
    ui.importMapping={...ui.importLayout.mapping};
    ui.importFile={...data,name:file.name};
    updatePreview();
  }catch(err){ui.importError=err.message||'Файл не удалось прочитать.';}
  finally{ui.importBusy=false;render();}
}
async function commitImport(){
  if(ui.importBusy||!ui.importPreview?.records.length)return;
  ui.importBusy=true;
  render();
  try{
    const {added,updated,duplicates,conflicts,assigned}=await run({type:'import-clients',clients:ui.importPreview.records,filename:ui.importFile.name});
    ui.importFile=null;
    ui.importLayout=null;
    ui.importMapping=null;
    ui.importPreview=null;
    go('home');
    if(aiAvailable)void analyzeMoney();
    notify('Добавлено: '+m.number(added)+' · обновлено: '+m.number(updated)+(duplicates?' · без изменений: '+m.number(duplicates):'')+(conflicts?' · конфликты: '+m.number(conflicts):'')+(assigned?' · задач от агента: '+m.number(assigned):''));
  }catch(err){ui.importError='Сохранение не удалось. '+err.message;}
  finally{ui.importBusy=false;render();}
}
function downloadSample(){
  const url=URL.createObjectURL(new Blob([demoCsv(m.branches)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download='glamour-шаблон-импорта.csv';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

document.addEventListener('click',event=>{
  const element=event.target.closest('[data-action]');
  if(!element||element.disabled)return;
  const {action}=element.dataset;
  const id=element.dataset.id||'';
  if(element.tagName==='A'&&(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return;
  event.preventDefault();
  switch(action){
    case 'navigate': go(id);break;
    case 'nav-toggle': ui.mobileNav=!ui.mobileNav;render();break;
    case 'theme': ui.theme=ui.theme==='light'?'dark':'light';savePrefs();applyTheme();render();document.querySelector('[data-action="theme"]')?.focus();break;
    case 'segment': go('clients',{segment:id});break;
    case 'more-clients': ui.clientLimit+=12;render();break;
    case 'money-all':
    case 'money-working':
      ui.homeFilter=action==='money-all'?'all':'working';ui.homeReason='';ui.homeLimit=8;
      render();document.querySelector('#money-clients h2').focus();break;
    case 'money-reason':
      ui.homeReason=ui.homeReason===id?'':id;ui.homeFilter='all';ui.homeLimit=8;render();
      document.querySelector('#money-clients h2').focus();break;
    case 'money-view':
      if(id==='reason'||id==='branch'){ui.moneyView=id;render();restoreSelection(action,id);}
      break;
    case 'money-branch':
      if(!id||m.byBranch(id)){ui.branch=ui.branch===id?'':id;ui.homeReason='';ui.homeLimit=8;ui.payWindow='';savePrefs();render();document.getElementById('branch-select').focus();}
      break;
    case 'pay-period':
      if(paymentPeriods.includes(Number(id))){ui.period=Number(id);ui.payWindow='';render();restoreSelection(action,id);}
      break;
    case 'pay-window': {
      const previous=ui.payWindow;
      ui.payWindow=previous===id?'':id;render();
      restoreSelection(action,id||previous);break;
    }
    case 'start-returns': go('contacts',{contactTab:'priority',contactReason:id});break;
    case 'payment-log': paymentLog(id);break;
    case 'money-ai': void analyzeMoney();break;
    case 'confirm-payment': confirmPayment(id);break;
    case 'profile': profileModal();break;
    case 'switch-profile': {
      if(serverMode||!m.byPerson(id,rawState))break;
      contactDrafts.clear();ui.profile=id;ui.branch='';useSnapshot(rawState);savePrefs();closeModal();go(manager()?'home':'contacts');break;
    }
    case 'logout': void logout();break;
    case 'client': clientModal(id);break;
    case 'new-task': taskModal('',id);break;
    case 'edit-task': taskModal(id);break;
    case 'desk-client': if(dialog.open)closeModal();openContactDesk(id);break;
    case 'desk-tab': selectDeskTab(id);break;
    case 'desk-move': moveDesk(id);break;
    case 'copy-desk-phone': void copyDeskPhone(id);break;
    case 'agent-step': applyAgentStep(id,element.hasAttribute('data-copy-objection'));break;
    case 'pick-outcome': applyAgentStep(id,false);break;
    case 'agent-use-example': useAgentExample();break;
    case 'agent-rate': void rateAgent(element);break;
    case 'run-agent': void runAgentNow(element);break;
    case 'quick-search': quickSearch();break;
    case 'batch': if(manager())batchModal();break;
    case 'reset-demo':
      if(manager()&&demoMode)present(modalHead('Сбросить демоданные?','Импортированные записи, задачи и настройки демо будут заменены исходными.')+
        '<form id="reset-form"><div class="modal-body"><div class="form-error" role="alert" hidden></div></div>'+modalFoot('Сбросить')+'</form>','reset');
      break;
    case 'home-filter': ui.homeFilter=id;ui.homeLimit=8;render();break;
    case 'more-contacts': ui.homeLimit+=8;render();break;
    case 'close': closeModal();break;
    case 'pick-file': document.getElementById('import-file')?.click();break;
    case 'commit-import': void commitImport();break;
    case 'template': downloadSample();break;
  }
});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!dialog.open){
    event.preventDefault();
    quickSearch();
  }
});
document.addEventListener('input',event=>{
  rememberDeskField(event.target);
  if(event.target.id==='quick-query')updateQuickSearch();
  if(event.target.dataset.filter==='query'){ui.query=event.target.value;ui.clientLimit=12;render(true);}
});
document.addEventListener('change',event=>{
  const field=event.target;
  if(field.id==='agent-option'||field.id==='agent-topic'){
    const {row}=deskSelection();
    if(row){
      const draft=deskDraft(row).values;
      if(field.id==='agent-topic'){draft.topic=field.value;draft.option='';}
      else draft.option=field.value;
      refreshAgentSuggestion();
      document.getElementById(field.id)?.focus();
    }
    return;
  }
  if(field.form?.id==='desk-contact-form'){
    rememberDeskField(field);
    if(field.name==='result')toggleOutcome(field.form);
    return;
  }
  if(field.dataset.map){
    if(field.value==='')delete ui.importMapping[field.dataset.map];
    else ui.importMapping[field.dataset.map]=Number(field.value);
    updatePreview();render(true);
    document.querySelector('.mapping-panel')?.setAttribute('open','');
    return;
  }
  if(field.id==='import-file'){void handleFile(field.files[0]);return;}
  if(dialog.contains(field)){
    if(field.form?.id==='batch-form'){
      batchPreview();
    }
    if(field.name==='status'||field.name==='result')toggleOutcome();
    if(field.dataset.filter==='period'&&modal.type==='payments'){ui.period=Number(field.value);ui.payWindow='';render();paymentLog();document.querySelector('#filter-period')?.focus();return;}
    if(field.name==='clientId'&&field.form?.id==='task-form'&&manager()){
      const client=m.byClient(state,field.value);
      const assignee=field.form.elements.assignee;
      if(!m.assignedBranches(m.byPerson(assignee.value)).includes(client?.branch))assignee.value=defaultAssignee(client?.branch)||'';
    }
    return;
  }
  const filter=field.dataset.filter;
  if(!filter||filter==='query')return;
  ui[filter]=filter==='period'?Number(field.value):field.value;
  ui.clientLimit=12;
  if(filter==='fallback')updatePreview();
  if(filter==='branch'){ui.homeReason='';ui.payWindow='';ui.homeLimit=8;savePrefs();}
  render(true);
});
document.addEventListener('dragover',event=>{
  const drop=event.target.closest('#dropzone');
  if(drop){event.preventDefault();drop.classList.add('dragover');}
});
document.addEventListener('dragleave',event=>{
  const drop=event.target.closest('#dropzone');
  if(drop&&!drop.contains(event.relatedTarget))drop.classList.remove('dragover');
});
document.addEventListener('drop',event=>{
  if(event.target.closest('#dropzone')){
    event.preventDefault();
    void handleFile(event.dataTransfer.files[0]);
  }
});
dialog.addEventListener('click',event=>{if(event.target===dialog)closeModal();});
dialog.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.target;
  if(modal?.type==='search'){
    form.querySelector('[data-action="client"]')?.click();
    return;
  }
  const submit=form.querySelector('[type="submit"]');
  const data=Object.fromEntries(new FormData(form));
  const current=modal;
  submit.disabled=true;
  try{
    if(current.type==='task'){
      await run({type:'save-task',task:{...data,id:current.id,appointment:current.appointment||'',service:current.service||''}});
      if(current.clientId)clientModal(current.clientId);
      else closeModal();
      notify(current.id?'Задача обновлена':'Задача создана');
    }
    if(current.type==='payment'){
      await run({type:'record-contact',clientId:current.id,values:data});
      clientModal(current.id);
      notify('Оплата подтверждена');
    }
    if(current.type==='reset'){
      await run({type:'reset-demo'});contactDrafts.clear();closeModal();go('home');notify('Демоданные восстановлены');
    }
    if(current.type==='batch'){
      const result=await run({type:'assign-outreach',...data,count:Number(data.count)});
      closeModal();
      notify('Назначено задач: '+m.number(result.assigned));
    }
  }catch(err){
    const message=form.querySelector('.form-error');
    message.textContent=err.message;
    message.hidden=false;
    submit.disabled=false;
  }
});

app.addEventListener('submit',event=>{
  if(event.target.id==='desk-contact-form'){event.preventDefault();void saveDeskResult(event);}
  else if(event.target.id==='agent-settings-form'){event.preventDefault();void saveAgentSettings(event.target);}
  else void submitMain(event);
});
applyTheme();
try {
  if(serverMode){
    const session=await repository.session();
    account=session.user;
    aiAvailable=Boolean(session.ai);
    if(account){ui.profile=account.id;useSnapshot(await repository.read());render();}
    else renderLogin();
  }else{useSnapshot(await repository.read());render();}
}
catch {app.innerHTML='<div class="boot" role="alert">Не удалось открыть хранилище. Проверьте разрешения браузера и перезагрузите страницу.</div>';}
