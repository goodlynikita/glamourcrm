import {agentState,identifyObjection,recommend} from './agent.mjs';
import {contactGroups,contactTabs,nextContact} from './contact-desk.mjs';
import {priorities,reasons,rulesFields,segmentKeys,terminalResults} from './retention.mjs';
import {icon} from './icons.mjs';
import * as m from './model.mjs';
import {readFile,previewRows,demoCsv,detectColumns,fieldLabels} from './importer.mjs';
import {repository,storageKey,serverMode,demoMode} from './repository.mjs';
import {actionDate,financeReport,isOpen,money,moneyInput,nextStep,selectDeals,stages} from './finance.mjs';

const app=document.querySelector('#app');
const dialog=document.querySelector('#dialog');
const toastEl=document.querySelector('#toast');
const preferencesKey='glamour-crm-preferences';
let savedPrefs={};
try {savedPrefs=JSON.parse(localStorage.getItem(preferencesKey)||'{}');} catch {}
const routes={
  home:['Рабочий стол','grid'],contacts:['Работа с клиентами','phone'],clients:['Клиенты','users'],tasks:['Задачи','checkList'],
  pipeline:['Воронка','funnel'],visits:['Записи','calendar'],branches:['Филиалы','building'],analytics:['Панель руководителя','chart'],import:['Импорт данных','upload'],settings:['Настройки','checkList'],agent:['Агент','sparkle']
};
const pageFromHash=()=>Object.hasOwn(routes,location.hash.slice(1))?location.hash.slice(1):'home';
const ui={
  page:pageFromHash(),theme:savedPrefs.theme==='dark'?'dark':'light',profile:m.byPerson(savedPrefs.profile)?.id||'manager',
  branch:m.byBranch(savedPrefs.branch)?.id||'',query:'',segment:'',taskStatus:'open',taskWhen:'',taskPriority:'',owner:'mine',
  homeFilter:'ready',homeReason:'',homeLimit:8,contactTab:'ready',contactClient:'',contactPinned:false,visitWeek:0,visitDay:'',pipelineView:savedPrefs.pipelineView==='list'?'list':'board',
  clientSort:'attention',period:30,reportReason:'',stage:'open',dealWindow:'',dealLimit:12,mobileNav:false,importFile:null,importLayout:null,importMapping:null,importPreview:null,importError:'',
  importBusy:false,fallback:m.byBranch(savedPrefs.branch)?.id||'center',clientLimit:12,taskLimit:15
};
let state, rawState, account, modal, toastTimer,contactSaving=false;
const contactDrafts=new Map();
const s=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const attr=(name,value)=>' '+name+'="'+s(value)+'"';
const cap=text=>text.charAt(0).toUpperCase()+text.slice(1);
const person=()=>serverMode?account:m.byPerson(ui.profile,rawState);
const manager=()=>!person()?.branch;
const managerPages=new Set(['analytics','import','settings','agent']);
const assignees=()=>m.people.filter(p=>p.branch&&(manager()||p.id===ui.profile));
const defaultAssignee=branch=>assignees().find(p=>m.assignedBranches(p).includes(branch))?.id;
const mine=()=>manager()?'':ui.profile;
const opts=(items,value)=>items.map(([key,label])=>'<option value="'+s(key)+'"'+(key===value?' selected':'')+'>'+s(label)+'</option>').join('');
const branchOpts=(current,all)=>opts([...(all?[['','Все филиалы']]:[]),...m.branches.map(b=>[b.id,b.label])],current);
const tag=(label,tone)=>'<span class="tag '+tone+'"><span></span>'+s(label)+'</span>';
const badge=(key,list=m.statuses)=>tag(list[key].label,list[key].tone);
const reasonTitle=key=>reasons[key||'manual']?.label||reasons.manual.label;
const iconBox=(name,tone)=>'<span class="icon-box '+tone+'">'+icon(name,19)+'</span>';
const logo='<img src="./assets/mark.svg" width="36" height="36" alt="">';
const tones=['berry','pink','stone','mint','peach'];
const avatar=(name,index=0)=>'<span aria-hidden="true" class="avatar '+tones[index%tones.length]+'">'+s(m.initials(name))+'</span>';
const clientAvatar=client=>avatar(client.name,Number(client.id.replace(/^c/,'').slice(0,2))||client.name.charCodeAt(0));
const control=(label,contents,classes='')=>'<label class="select-control '+classes+'"><span class="sr-only">'+s(label)+'</span>'+contents+icon('chevron',15)+'</label>';
const button=(label,ic,style,action,extra='')=>'<button type="button" class="button '+style+'" data-action="'+action+'" '+extra+'>'+ (ic?icon(ic,17):'')+s(label)+'</button>';
const empty=(title,text,ic='folder')=>'<div class="empty">'+iconBox(ic,'berry')+'<strong>'+s(title)+'</strong>'+(text?'<p>'+s(text)+'</p>':'')+'</div>';
const typeIcon={visit:'calendar',call:'phone',payment:'wallet'};

function savePrefs(){
  try {localStorage.setItem(preferencesKey,JSON.stringify({theme:ui.theme,profile:ui.profile,branch:ui.branch,pipelineView:ui.pipelineView}));} catch {}
}
function applyTheme(){
  document.documentElement.dataset.theme=ui.theme;
  document.querySelector('meta[name="theme-color"]').content=ui.theme==='dark'?'#1a1719':'#f7f6f6';
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
      opportunities:rawState.opportunities.filter(deal=>ids.has(deal.clientId)),imports:[],
      agent:{...rawState.agent,lastRun:null,feedback:rawState.agent.feedback.filter(item=>owned.includes(item.branch))},
      settings:{...settings,branches:settings.branches.filter(branch=>owned.includes(branch.id)),
        users:settings.users.filter(user=>m.assignedBranches(user).some(branch=>owned.includes(branch)))}};
  }else state=rawState;
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
  ui.query='';ui.segment='';ui.taskStatus='open';ui.taskWhen='';ui.taskPriority='';ui.owner='mine';ui.clientSort='attention';
  ui.clientLimit=12;ui.taskLimit=15;ui.dealLimit=12;ui.stage='open';ui.dealWindow='';ui.homeFilter='ready';ui.homeReason='';ui.homeLimit=8;ui.contactTab='ready';ui.contactClient='';ui.contactPinned=false;ui.visitWeek=0;ui.visitDay='';ui.mobileNav=false;
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
  return '<div class="layout"><aside class="sidebar'+(ui.mobileNav?' mobile-open':'')+'"><a href="#home" class="brand" data-action="navigate" data-id="home">'+logo+'<span><strong>GLAMOUR</strong><small>САЛОННАЯ CRM</small></span></a>'+
    '<div class="workspace"><span class="workspace-logo">'+icon('building',18)+'</span><span><strong>Сеть салонов</strong><small>GLAMOUR · Ижевск</small></span></div>'+
    '<nav aria-label="Разделы"><p class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p>'+navEntry('home')+navEntry('contacts')+navEntry('clients')+navEntry('tasks',taskCount)+navEntry('pipeline')+navEntry('visits')+navEntry('branches')+
    (manager()?'<p class="nav-caption tools-caption">УПРАВЛЕНИЕ</p>'+navEntry('analytics')+navEntry('agent')+navEntry('import')+navEntry('settings'):'')+'</nav>'+
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
function stat(name,value,detail,ic,tone,action='',id='',window=''){
  const info='<div class="stat-top">'+iconBox(ic,tone)+'<span>'+s(name)+'</span></div><strong>'+s(typeof value==='number'?m.number(value):value)+'</strong><small>'+s(detail)+'</small>';
  return action?'<button class="stat-card" data-action="'+action+'" data-id="'+id+'" data-window="'+window+'" type="button">'+info+'</button>':'<article class="stat-card">'+info+'</article>';
}
function due(task){
  const day=m.today();
  if(task.status==='done') return '<time datetime="'+s(task.due)+'">'+m.formatDate(task.due)+'</time>';
  let label=m.formatDate(task.due), css='';
  if(task.due===day){label='Сегодня';css='due-today';}
  else if(task.due===m.shiftDate(day,1)) label='Завтра';
  else if(task.due<day) css='due-late';
  return '<time datetime="'+s(task.due)+'" title="'+s(m.longDate(task.due))+'" class="'+css+'">'+s(label)+'</time>';
}
function taskTable(tasks){
  if(!tasks.length)return empty('Задач по этим условиям нет','Измените фильтры или назначьте новую задачу.','checkList');
  const rows=tasks.map(task=>{
    const client=m.byClient(state,task.clientId);
    return '<tr><td><button type="button" class="identity" data-action="client" data-id="'+s(client.id)+'">'+clientAvatar(client)+'<span><strong>'+s(client.name)+'</strong><small>'+s(m.formatPhone(client.phone))+' · '+s(m.byBranch(client.branch).name)+'</small></span></button></td><td><button type="button" class="task-title" data-action="edit-task" data-id="'+s(task.id)+'">'+s(task.title)+'</button><small class="cell-note">'+s(reasonTitle(task.reason))+'</small></td>'+
      '<td>'+s(m.byPerson(task.assignee)?.name||'—')+'</td>'+
      '<td>'+badge(task.priority||'normal',priorities)+'</td><td class="nowrap">'+due(task)+displayDueTime(task)+'</td><td>'+badge(task.status)+(task.result?'<small class="cell-note">'+s(m.outcomes[task.result])+'</small>':'')+'</td><td class="row-end"><button class="row-button" type="button" data-action="edit-task" data-id="'+s(task.id)+'" aria-label="'+s('Открыть задачу '+task.title)+'">'+icon('right',16)+'</button></td></tr>';
  }).join('');
  return '<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Задача</th>'+'<th>Ответственный</th>'+'<th>Приоритет</th><th>Срок</th><th>Статус</th><th aria-label="Действия"></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
const categoryOptions=keys=>keys.map(key=>[key,reasonTitle(key)]);
const clientCategories=[...segmentKeys,'future','working','excluded','unknown','clear'];
const displayDueTime=task=>task.dueTime?'<small class="cell-note">'+s(task.dueTime)+'</small>':'';
const contactDraftFields=['result','followUp','followUpTime','appointment','visitTime','service','plannedInput','note'];
function scopedContactGroups(){
  return contactGroups(state,{branch:ui.branch,assignee:mine()});
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
    const client=m.byClient(state,row.clientId);
    const deal=row.deal??state.opportunities.find(item=>item.clientId===client.id&&isOpen(item));
    const lastNote=m.clientHistory(state,client).find(event=>event.kind==='call'&&event.note)?.note;
    const fromHistory=Boolean(lastNote&&identifyObjection(lastNote)!=='other');
    contactDrafts.set(key,{objection:fromHistory?lastNote.slice(0,900):'',fromHistory,option:'',result:'',note:'',followUp:m.shiftDate(m.today(),1),followUpTime:'',
      service:deal?.service||m.lastKnownVisit(state,client).service,plannedInput:moneyInput(deal?.planned),visitTime:'',appointment:''});
  }
  return {key,values:contactDrafts.get(key)};
}
function openContactDesk(id){
  if(!m.byClient(state,id)||contactSaving)return;
  const groups=scopedContactGroups();
  const tab=groups.ready.some(row=>row.clientId===id)?'ready':
    groups.followup.some(row=>row.clientId===id)?'followup':'all';
  go('contacts',{contactTab:tab,contactClient:id,contactPinned:!groups.all.some(row=>row.clientId===id)});
}
function deskFact(label,value){
  return '<div><dt>'+s(label)+'</dt><dd>'+s(value??'—')+'</dd></div>';
}
function deskHistory(client){
  const events=m.clientHistory(state,client).slice(0,6);
  return '<section class="panel desk-panel"><div class="panel-head"><h2>История клиента</h2>'+iconBox('clock','stone')+'</div>'+
    (events.length?'<ol class="desk-history">'+events.map(event=>{
      const label=event.kind==='call'?m.outcomes[event.result]:event.kind==='payment'?'Оплата · '+money(event.amount):event.title;
      const details=[event.assignee?m.byPerson(event.assignee)?.name:'',event.appointment?'Запись '+m.longDate(event.appointment):''].filter(Boolean);
      return '<li><span class="history-point"></span><div><div class="history-meta"><strong>'+s(label)+'</strong><time datetime="'+s(event.date)+'">'+s(m.formatDate(event.date))+'</time></div>'+
        (details.length?'<small>'+s(details.join(' · '))+'</small>':'')+(event.note?'<p>'+s(event.note)+'</p>':'')+'</div></li>';
    }).join('')+'</ol>':'<p class="desk-empty-history">Пока нет записей в истории.</p>')+'</section>';
}
function deskAgentSuggestion(client,draft){
  if(!draft.objection.trim()){
    const preparation={cancellation:'Спросите, что помешало прийти, и проверьте возможные даты для новой записи.',
      regular:'Уточните, изменились ли пожелания по последней услуге, и предложите удобный следующий шаг.',
      single:'Спросите, как прошёл первый визит и что можно сделать удобнее при повторной записи.',
      inactive:'Уточните, актуальна ли сейчас услуга, и проверьте ближайшие варианты записи.'}[m.retentionReason(state,client)];
    return preparation?'<p class="desk-empty-agent"><strong>Перед звонком</strong> · '+s(preparation)+'</p>':
      '<p class="desk-empty-agent">Введите возражение, чтобы агент предложил ответ.</p>';
  }
  const suggestion=recommend(draft.objection,agentState(state).feedback,client.branch);
  const option=suggestion.options.find(item=>item.id===draft.option)||suggestion.options[0];
  const vote=agentState(state).feedback.find(item=>item.clientId===client.id&&item.objection===suggestion.key&&item.option===option.id);
  const extra='data-key="'+suggestion.key+'" data-option="'+option.id+'"';
  return '<div class="agent-suggestion"><div class="agent-suggestion-head"><div>'+tag(suggestion.label,suggestion.key==='stop'?'red':'berry')+'</div>'+
    (suggestion.options.length>1?'<label class="sr-only" for="agent-option">Вариант ответа</label><select id="agent-option" aria-label="Вариант ответа" data-agent-option>'+
      opts(suggestion.options.map((item,index)=>[item.id,'Вариант '+(index+1)]),option.id)+'</select>':'')+'</div>'+
    '<div class="agent-response"><h3>Что ответить</h3><blockquote>'+s(option.reply)+'</blockquote><h3>Следующий шаг</h3><p>'+s(option.step)+'</p></div>'+
    '<div class="agent-tools">'+button('Применить шаг',null,'secondary small','agent-step','data-id="'+option.outcome+'"')+
    button(vote?.helpful===true?'Помогло ✓':'Помогло',null,'secondary small','agent-rate',extra+' data-helpful="true" aria-pressed="'+(vote?.helpful===true)+'"')+
    button(vote?.helpful===false?'Не помогло ✓':'Не помогло',null,'secondary small','agent-rate',extra+' data-helpful="false" aria-pressed="'+(vote?.helpful===false)+'"')+'</div>'+
    '<p class="agent-basis">'+(suggestion.votes?'Учтено отметок по этому возражению в филиале: '+m.number(suggestion.votes):'Отметьте результат, чтобы улучшить следующую подсказку.')+'</p></div>';
}
function deskAgentPanel(client,draft){
  return '<section class="panel desk-panel desk-agent"><div class="panel-head"><div><h2>Помощник по возражениям</h2></div>'+iconBox('sparkle','berry')+'</div>'+
    '<div class="desk-agent-inner">'+field(draft.fromHistory?'Из предыдущего контакта':'Что сказал клиент','<textarea rows="2" maxlength="900" id="agent-objection" placeholder="Например, мне дорого или неудобно по времени">'+
      s(draft.objection)+'</textarea>')+'<div id="agent-suggestion" aria-live="polite">'+deskAgentSuggestion(client,draft)+'</div></div></section>';
}
function deskClientCard(row,index,rows){
  const client=m.byClient(state,row.clientId);
  const record=deskDraft(row);
  const {values:draft}=record;
  const last=m.lastKnownVisit(state,client);
  const future=m.retentionReason(state,client)==='future';
  const excluded=client.callBlocked||client.invalidPhone;
  const callable=!excluded&&!(!row.task&&future)&&Boolean(row.assignee&&client.phone);
  const reason=row.task?.originReason||row.task?.reason||m.retentionReason(state,client);
  const title=row.task?.title||(row.deal?nextStep(row.deal,m.today()):'Связаться с клиентом');
  const owner=m.byPerson(row.assignee)?.name;
  const deal=row.deal??state.opportunities.find(item=>item.clientId===client.id&&isOpen(item));
  const status=row.task?.status||'';
  const latest=state.opportunities.filter(item=>item.clientId===client.id&&item.stage==='paid'&&item.actual!=null)
    .sort((a,b)=>b.paymentDate.localeCompare(a.paymentDate))[0];
  const when=row.due?[m.longDate(row.due),row.task?.dueTime].filter(Boolean).join(' · '):'Без срока';
  const canAdvance=index>=0&&rows.length>1;
  const fill=draft;
  const form='<form id="desk-contact-form" data-key="'+s(record.key)+'" data-client="'+s(client.id)+'" data-task="'+s(row.task?.id||'')+'">'+
    '<div class="desk-form form-grid">'+outcomeFields(fill)+followUpFields(draft)+
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
    '<div class="desk-reason"><div class="desk-kicker">Причина контакта</div><strong>'+s(reasonTitle(reason))+'</strong><p>'+s(title)+'</p>'+
    '<div class="desk-task-meta">'+icon('calendar',16)+s(when)+(owner?'<span>'+s(owner)+'</span>':'')+(status?badge(status):'')+'</div></div>'+
    (row.task?.note?'<p class="desk-task-note">'+s(row.task.note)+'</p>':'')+'</section>'+
    '<section class="panel desk-panel desk-result"><div class="panel-head"><h2>Результат контакта</h2>'+iconBox('checkList','pink')+'</div>'+
    (callable?form:'<p class="desk-empty-agent">'+s(excluded?'Клиент исключён из контактов.':future?'У клиента есть будущая запись.':'Нет номера телефона или ответственного.')+'</p>')+'</section></div>'+
    '<aside class="desk-column">'+(callable?deskAgentPanel(client,draft):'')+'<section class="panel desk-panel"><div class="panel-head"><h2>О клиенте</h2>'+
    button('Полная карточка',null,'secondary small','client','data-id="'+s(client.id)+'"')+'</div>'+
    '<dl class="desk-facts">'+deskFact('Последний визит',last.lastVisit?m.longDate(last.lastVisit):'Нет данных')+
    deskFact('Визитов по выгрузке',client.visitCount)+deskFact('Последняя услуга',last.service||'—')+
    deskFact('Запись',m.longDate(deal?.visitDate||client.nextBooking))+deskFact('Последняя отмена',m.longDate(client.lastCancellation))+
    deskFact('Сегмент',reasonTitle(m.retentionReason(state,client)))+'</dl>'+
    (deal?.planned!=null||latest?'<dl class="desk-money">'+(deal?.planned!=null?deskFact('Сумма в работе',money(deal.planned)):'')+
      (latest?deskFact('Последняя оплата',money(latest.actual)):'')+'</dl>':'')+'</section>'+deskHistory(client)+'</aside></div>';
}
function contactDeskPage(){
  const {groups,rows,row,index}=deskSelection();
  const controlButton=(label,direction,disabled)=>button(label,null,'secondary small','desk-move',
    'data-id="'+direction+'"'+(disabled||contactSaving?' disabled':''));
  return heading('Работа с клиентами','',manager()?button('Назначить обзвон','plus','secondary','batch'):'')+
    '<section class="panel desk-toolbar"><div class="desk-toolbar-tabs">'+tabs(Object.entries(contactTabs).map(([key,label])=>
      [key,label+' · '+m.number(groups[key].length)]),ui.contactTab,'desk-tab')+'</div><div class="desk-nav">'+
    controlButton('Предыдущий','prev',index<=0)+'<div class="desk-position" aria-live="polite">'+
    (index>=0?'<span><strong>'+m.number(index+1)+'</strong> из '+m.number(rows.length)+'</span><progress aria-label="Позиция в очереди" value="'+(index+1)+'" max="'+rows.length+'"></progress>':
      '<span>'+(row?'Отдельная карточка':'Очередь пуста')+'</span>')+'</div>'+
    controlButton('Следующий','next',index<0||index>=rows.length-1)+'</div></section>'+
    (row?deskClientCard(row,index,rows):'<section class="panel">'+empty('В этой очереди пока нет клиентов','Выберите другой фильтр или проверьте назначение задач.','phone')+'</section>');
}
function agentPage(){
  const config=agentState(state);
  return heading('Агент','',button('Подготовить очередь','checkList','primary','run-agent'))+
    '<div class="agent-management"><section class="panel"><div class="panel-head"><div><h2>Автоматическое назначение</h2><p>По настроенным сегментам</p></div>'+
    tag(config.auto?'Включено':'Выключено',config.auto?'green':'slate')+'</div><form id="agent-settings-form"><div class="modal-body form-grid">'+
    '<label class="agent-check wide"><input type="checkbox" name="auto"'+(config.auto?' checked':'')+'>Автоматически назначать задачи после импорта</label>'+
    field('До задач на филиал в день',input('limit',config.limit,'number','required min="1" max="50"'))+
    '<p class="secondary-text wide">'+(serverMode?'Сервер также проверяет очередь каждые 15 минут.':'В демо агент запускается после импорта или кнопкой выше.')+'</p>'+
    '<div class="form-error wide" role="alert" hidden></div><button class="button secondary" type="submit">Сохранить</button></div></form></section>'+
    '<section class="panel"><div class="panel-head"><div><h2>Результаты агента</h2></div>'+iconBox('chart','berry')+'</div><div class="modal-body agent-run">'+
    '<div><strong>'+m.number(config.lastRun?.assigned??0)+'</strong><span>Задач в последнем запуске с назначениями</span></div>'+
    '<div><strong>'+m.number(config.feedback.length)+'</strong><span>Отметок по подсказкам</span></div>'+
    (config.lastRun?'<ul>'+config.lastRun.branches.map(item=>'<li>'+s(m.byBranch(item.id)?.name||'Филиал')+' · '+m.number(item.assigned)+'</li>').join('')+'</ul>':'')+
    '</div></section></div>';
}

function selectDeskTab(id){
  if(contactSaving||!Object.hasOwn(contactTabs,id))return;
  ui.contactTab=id;
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
  if(panel&&row)panel.innerHTML=deskAgentSuggestion(m.byClient(state,row.clientId),deskDraft(row).values);
}
function applyAgentStep(result){
  const form=document.querySelector('#desk-contact-form');
  if(!form||!Object.hasOwn(m.outcomes,result)||contactSaving)return;
  form.elements.result.value=result;
  rememberDeskField(form.elements.result);
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
    notify(data.result==='booked'?'Клиент записан':terminalResults.has(data.result)?'Результат сохранён':
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

function bookingWeek(){
  const day=m.today();
  const weekday=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
  return m.shiftDate(day,ui.visitWeek*7-weekday);
}
function branchBookings(){
  return selectDeals(state,{branch:ui.branch,stage:'booked'}).sort((a,b)=>
    a.visitDate.localeCompare(b.visitDate)||(a.visitTime||'99:99').localeCompare(b.visitTime||'99:99'));
}
function contactTime(date){
  const day=m.today();
  if(!date)return '<span class="secondary-text">Без срока</span>';
  return due({status:'new',due:date});
}
function contactTable(rows){
  if(!rows.length)return empty('Очередь свободна','', 'phone');
  return '<div class="table-wrap"><table class="contact-table"><thead><tr><th>Клиент</th><th>Действие</th><th>Срок</th><th aria-label="Результат"></th></tr></thead><tbody>'+
    rows.map(row=>{
      const c=m.byClient(state,row.clientId);
      const summary=row.task?.title||nextStep(row.deal,m.today());
      const reason=row.task?.reason||m.retentionReason(state,c);
      return '<tr><td><button class="identity" type="button" data-action="client" data-id="'+s(c.id)+'">'+clientAvatar(c)+
        '<span><strong>'+s(c.name)+'</strong><small>'+s(m.byBranch(c.branch).name)+' · '+s(m.formatPhone(c.phone))+'</small></span></button></td>'+
        '<td><span class="work-action">'+s(summary)+'</span><small class="cell-note">'+s(reasonTitle(reason))+(row.task?.priority==='high'?' · высокий приоритет':'')+'</small></td>'+
        '<td class="nowrap">'+contactTime(row.due)+displayDueTime(row.task||{})+'</td><td class="row-end">'+button('Результат','phone','secondary small','quick-contact',
          'data-id="'+s(c.id)+'"')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
function compactPipeline(){
  const incoming=selectDeals(state,{branch:ui.branch,assignee:mine(),stage:'open'});
  const total=incoming.some(item=>item.planned!=null)?incoming.reduce((sum,item)=>sum+(item.planned??0),0):null;
  return '<section class="panel snapshot"><div class="panel-head"><div><h2>Воронка</h2><p>Сумма в работе</p></div>'+iconBox('funnel','pink')+'</div>'+
    '<div class="snapshot-total">'+s(money(total))+'<small>'+m.number(incoming.length)+' клиентов</small></div><div class="snapshot-stages">'+
    ['contact','interested','booked'].map(key=>{
      const rows=incoming.filter(item=>item.stage===key);
      const sum=rows.reduce((value,item)=>value+(item.planned??0),0);
      return '<button class="snapshot-stage" type="button" data-action="work-pipeline" data-id="'+key+'"><span class="stage-mark '+stages[key].tone+'"></span>'+
        '<span>'+stages[key].label+'</span><span>'+rows.length+'</span><strong>'+s(money(rows.length&&rows.every(item=>item.planned===null)?null:sum))+'</strong></button>';
    }).join('')+'</div><div class="snapshot-foot">'+button('Открыть воронку',null,'secondary small','navigate','data-id="pipeline"')+'</div></section>';
}
function revenueChart(branch,days){
  const day=m.today();
  const from=m.shiftDate(day,1-days);
  const byDay=new Map();
  for(const deal of selectDeals(state,{branch,stage:'paid'})){
    if(deal.paymentDate>=from&&deal.paymentDate<=day)byDay.set(deal.paymentDate,(byDay.get(deal.paymentDate)||0)+deal.actual);
  }
  const cols=days===7?7:6;
  const perColumn=days/cols;
  const groups=Array.from({length:cols},(_,index)=>{
    const start=m.shiftDate(from,index*perColumn);
    const end=m.shiftDate(start,perColumn-1);
    let total=0;
    for(const [date,value] of byDay)if(start<=date&&date<=end)total+=value;
    return {start,end,total};
  });
  const highest=Math.max(1,...groups.map(group=>group.total));
  return '<section class="panel revenue-panel"><div class="panel-head"><div><h2>Динамика выручки</h2><p>Оплаты за '+days+' дн.</p></div>'+
    (ui.page==='analytics'?'':button('Отчёт',null,'secondary small','navigate','data-id="analytics"'))+'</div>'+
    '<ol class="revenue-chart" aria-label="Выручка по датам">'+groups.map(group=>{
      const interval=m.formatDate(group.start)+(group.end===group.start?'':' – '+m.formatDate(group.end));
      const description=interval+': '+money(group.total);
      return '<li aria-label="'+s(description)+'" title="'+s(description)+'"><div class="bar-area"><span class="bar-amount">'+s(group.total?money(group.total):'')+'</span>'+
        '<span class="cash-bar" style="--height:'+Math.round(group.total/highest*74)+'%"></span></div><span class="bar-date">'+s(m.formatDate(group.start))+'</span></li>';
    }).join('')+'</ol></section>';
}
function upcomingPanel(bookings){
  return '<section class="panel"><div class="panel-head"><div><h2>Ближайшие записи</h2><p>Следующие 7 дней</p></div>'+
    button('Расписание',null,'secondary small','navigate','data-id="visits"')+'</div><div class="upcoming-list">'+
    (bookings.length?bookings.slice(0,4).map(deal=>{
      const c=m.byClient(state,deal.clientId);
      return '<button class="upcoming-item" type="button" data-action="edit-deal" data-id="'+s(deal.id)+'"><span class="mini-date">'+s(m.formatDate(deal.visitDate,{day:'numeric'}))+
        '<small>'+s(m.formatDate(deal.visitDate,{month:'short'}))+'</small></span><span><strong>'+s(c.name)+'</strong><small>'+
        s([deal.visitTime,deal.service||m.byBranch(c.branch).name].filter(Boolean).join(' · '))+'</small></span><strong>'+s(money(deal.planned))+'</strong></button>';
    }).join(''):empty('Записей на этой неделе нет','','calendar'))+'</div></section>';
}
function home(){
  const day=m.today();
  const rows=m.contactQueue(state,{branch:ui.branch,assignee:mine()});
  const late=rows.filter(row=>row.due&&row.due<day);
  const ready=rows.filter(row=>row.due&&row.due<=day);
  const contacts={ready,late,all:rows}[ui.homeFilter].filter(row=>!ui.homeReason||
    (row.task?.reason||m.retentionReason(state,m.byClient(state,row.clientId)))===ui.homeReason);
  const bookings=branchBookings().filter(deal=>deal.visitDate>=day&&deal.visitDate<=m.shiftDate(day,6));
  const revenue=cashReport(ui.branch);
  const eligible=m.metrics(state,ui.branch).attention;
  return heading('Рабочий стол','',
    '<span class="date-chip">'+icon('calendar',17)+s(cap(m.formatDate(day,{weekday:'long',day:'numeric',month:'long'})))+'</span>'+
    button('Обрабатывать контакты','phone','primary','navigate','data-id="contacts"'))+
    '<section class="stats work-stats" aria-label="Основные показатели">'+
    stat('Контакты к сроку',ready.length,late.length?'Просрочено: '+late.length:'На сегодня','phone','berry','home-filter','ready')+
    stat('Требуют внимания',eligible,'По правилам сегментации','target','pink','segment','focus')+
    stat('Записи на 7 дней',bookings.length,bookings.some(deal=>deal.planned!=null)?money(bookings.reduce((sum,deal)=>sum+(deal.planned??0),0)):'Расписание','calendar','stone','navigate','visits')+
    (manager()&&revenue.paidCount?stat('Выручка',money(revenue.revenue),'Оплачено за '+ui.period+' дн.','wallet','mint','navigate','analytics'):
      stat('Задачи открыты',rows.length,'С назначенным контактом','checkList','mint','navigate','tasks'))+'</section>'+
    '<div class="dashboard-grid work-grid"><section class="panel queue-panel"><div class="panel-head"><div><h2>Очередь контактов</h2><p>'+(mine()?'Мои клиенты':'Вся команда')+'</p></div>'+
    (manager()?button('Назначить обзвон','plus','secondary small','batch'):'')+'</div><div class="queue-tabs queue-filters">'+
    tabs([['ready','К сроку '+ready.length],['late','Просрочены '+late.length],['all','Все '+rows.length]],ui.homeFilter,'home-filter')+
    filterSelect('homeReason','Причина задачи',[['','Все причины'],...categoryOptions([...segmentKeys,'followup','manual'])],ui.homeReason)+'</div>'+
    contactTable(contacts.slice(0,ui.homeLimit))+(contacts.length>ui.homeLimit?footerCount(contacts.length,ui.homeLimit,'more-contacts'):'')+'</section>'+compactPipeline()+'</div>'+
    '<div class="dashboard-grid work-grid">'+(manager()&&revenue.paidCount?revenueChart(ui.branch,ui.period):'')+upcomingPanel(bookings)+'</div>';
}

function visitsPage(){
  const day=m.today();
  const start=bookingWeek();
  const end=m.shiftDate(start,6);
  const bookings=branchBookings();
  const overdue=bookings.filter(deal=>deal.visitDate<day);
  const visitHistory=selectDeals(state,{branch:ui.branch,stage:'paid'});
  const week=[...bookings.filter(deal=>deal.visitDate>=day),...visitHistory]
    .filter(deal=>deal.visitDate>=start&&deal.visitDate<=end)
    .sort((a,b)=>a.visitDate.localeCompare(b.visitDate)||(a.visitTime||'99:99').localeCompare(b.visitTime||'99:99'));
  const selected=ui.visitDay&&ui.visitDay>=start&&ui.visitDay<=end?ui.visitDay:'';
  const filtered=selected?week.filter(deal=>deal.visitDate===selected):week;
  return heading('Записи','',button('Эта неделя','calendar','secondary','week-current')+
    button('Добавить запись','plus','primary','new-booking'))+
    (overdue.length?'<section class="panel overdue-panel"><div class="panel-head"><div><h2>Проверьте результат визита</h2><p>'+
      'Ожидают отметки: '+m.number(overdue.length)+'</p></div>'+iconBox('clock','amber')+'</div>'+visitTable(overdue)+'</section>':'')+
    '<section class="panel"><div class="panel-head visit-head"><div><h2>'+s(m.formatDate(start))+' – '+s(m.formatDate(end))+'</h2><p>'+'Записей: '+m.number(week.length)+'</p></div><div class="week-actions">'+
    button('Назад',null,'secondary small','week-prev')+button('Вперёд',null,'secondary small','week-next')+'</div></div>'+
    '<div class="week-days">'+Array.from({length:7},(_,index)=>{
      const date=m.shiftDate(start,index);
      const count=week.filter(entry=>entry.visitDate===date).length;
      return '<button type="button" class="week-day'+(date===day?' day-today':'')+'" aria-pressed="'+(selected===date)+
        '" data-action="visit-day" data-id="'+date+'"><small>'+s(m.formatDate(date,{weekday:'short'}))+'</small><strong>'+s(m.formatDate(date,{day:'numeric'}))+
        '</strong><span>'+count+'</span></button>';
    }).join('')+'</div>'+visitTable(filtered)+'</section>';
}
function visitTable(bookings){
  if(!bookings.length)return empty('Записей нет','','calendar');
  return '<div class="table-wrap"><table class="visit-table"><thead><tr><th>Дата и время</th><th>Клиент</th><th>Сумма</th><th aria-label="Действия"></th></tr></thead><tbody>'+
    bookings.map(deal=>{
      const c=m.byClient(state,deal.clientId);
      const paid=deal.stage==='paid';
      const ready=!paid&&deal.visitDate<=m.today();
      return '<tr><td class="nowrap"><strong>'+s(m.formatDate(deal.visitDate))+'</strong><small class="cell-note">'+s(deal.visitTime||'Время не задано')+'</small></td><td>'+
        '<button type="button" class="identity" data-action="client" data-id="'+s(c.id)+'">'+clientAvatar(c)+'<span><strong>'+s(c.name)+'</strong><small>'+
        s(deal.service||m.byBranch(c.branch).name)+'</small></span></button></td><td class="nowrap"><strong>'+s(money(paid?deal.actual:deal.planned))+'</strong>'+
        (paid?'<small class="cell-note">Оплачено</small>':'<small class="cell-note">План</small>')+'</td>'+
        '<td class="row-end visit-cell">'+button('Изменить',null,'secondary small','edit-deal','data-id="'+s(deal.id)+'"')+
        (ready?button('Не пришёл',null,'secondary small','visit-missed','data-id="'+s(deal.id)+'"')+
          button('Оплата',null,'primary small','visit-pay','data-id="'+s(deal.id)+'"'):'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
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
  let list=state.clients.filter(c=>(!ui.branch||c.branch===ui.branch)&&m.matches(c,ui.query)
    &&(!ui.segment||(ui.segment==='focus'?segmentKeys.includes(m.retentionReason(state,c)):
      ui.segment==='working'?m.displayedReason(state,c)==='working':m.retentionReason(state,c)===ui.segment)));
  list=list.map(client=>({...client,...m.lastKnownVisit(state,client)}));
  list.sort((a,b)=>ui.clientSort==='name'?a.name.localeCompare(b.name,'ru'):
    (a.lastVisit||'9999').localeCompare(b.lastVisit||'9999')||a.name.localeCompare(b.name,'ru'));
  const items=list.slice(0,ui.clientLimit).map(c=>{
    const gap=c.lastVisit?m.dateDiff(m.today(),c.lastVisit):null;
    return '<tr><td><button class="identity" type="button" data-action="desk-client" data-id="'+s(c.id)+'">'+clientAvatar(c)+'<span><strong>'+s(c.name)+'</strong><small>'+s(m.formatPhone(c.phone))+'</small></span></button></td>'+
      '<td>'+s(m.byBranch(c.branch).name)+'</td><td>'+s(c.lastVisit?m.longDate(c.lastVisit):'Нет данных')+(gap!==null?'<small class="cell-note">'+m.number(gap)+' дн. назад</small>':'')+'</td><td>'+badge(m.retentionReason(state,c),reasons)+
      (m.displayedReason(state,c)==='working'?'<small class="cell-note">Уже в работе</small>':'')+'</td>'+
      '<td class="row-end"><button class="row-button" type="button" data-action="client" data-id="'+s(c.id)+'" aria-label="'+s('Открыть карточку '+c.name)+'">'+icon('right',16)+'</button></td></tr>';
  }).join('');
  return heading('Клиенты','',button('Работа с клиентами','phone','primary','navigate','data-id="contacts"')+
    (manager()?button('Импорт данных','upload','secondary','navigate','data-id="import"')+button('Назначить обзвон','plus','secondary','batch'):''))+
    '<section class="panel"><div class="toolbar">'+searchInput('Поиск по имени или телефону')+
    filterSelect('segment','Сегмент клиентов',[['','Все сегменты'],['focus','Требуют внимания'],...categoryOptions(clientCategories)],ui.segment)+
    filterSelect('clientSort','Порядок сортировки',[['attention','По давности визита'],['name','По имени']],ui.clientSort)+'</div>'+
    (list.length?'<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Филиал</th><th>Последний визит</th><th>Сегмент</th><th aria-label="Действия"></th></tr></thead><tbody>'+items+'</tbody></table></div>':
    empty('Клиенты не найдены','Попробуйте изменить поиск или фильтры.','users'))+footerCount(list.length,ui.clientLimit,'more-clients')+'</section>';
}
function tasksPage(){
  const assignee=ui.owner==='mine'?mine():ui.owner;
  const list=m.queue(state,{branch:ui.branch,assignee,status:ui.taskStatus,when:ui.taskWhen,query:ui.query}).filter(task=>!ui.taskPriority||(task.priority||'normal')===ui.taskPriority);
  return heading('Задачи','',button('Новая задача','plus','primary','new-task'))+
    '<section class="panel"><div class="tab-wrap">'+tabs([['open','Открытые'],['new','К выполнению'],['progress','В работе'],['done','Выполненные'],['','Все']],ui.taskStatus,'status')+'</div><div class="toolbar">'+searchInput('Поиск по задаче или клиенту')+
    filterSelect('owner','Ответственный',[...(mine()?[['mine','Мои задачи']]:[['mine','Вся команда']]),...m.people.filter(p=>p.branch).map(p=>[p.id,p.name]),...(mine()?[['','Вся команда']]:[])],ui.owner)+
    filterSelect('taskWhen','Срок задачи',[['','Любой срок'],['today','Сегодня'],['late','Просрочено']],ui.taskWhen)+
    filterSelect('taskPriority','Приоритет',[['','Любой приоритет'],...Object.entries(priorities).map(([key,value])=>[key,value.label])],ui.taskPriority)+'</div>'+
    taskTable(list.slice(0,ui.taskLimit))+footerCount(list.length,ui.taskLimit,'more-tasks')+'</section>';
}
function branchesPage(){
  const list=m.branches.filter(b=>!ui.branch||b.id===ui.branch);
  return heading('Филиалы','')+'<div class="branch-grid">'+list.map(b=>{
    const data=m.metrics(state,b.id);
    const admin=m.people.find(p=>m.assignedBranches(p).includes(b.id));
    return '<article class="panel branch-card"><div class="branch-head">'+iconBox('building',b.color==='pink'?'pink':'berry')+'<div><h2>'+s(b.name)+'</h2><p>'+s(b.label)+'</p></div></div><div class="branch-admin">'+(admin?avatar(admin.name,1)+'<div><strong>'+s(admin.name)+'</strong><small>Администратор</small></div>':'<span class="secondary-text">Администратор не назначен</span>')+'</div><dl><div><dt>Клиенты</dt><dd>'+m.number(data.total)+'</dd></div><div><dt>Требуют внимания</dt><dd>'+m.number(data.attention)+'</dd></div><div><dt>Открытые задачи</dt><dd>'+m.number(data.open)+'</dd></div></dl>'+button('Клиенты филиала',null,'secondary','open-branch','data-id="'+b.id+'"')+'</article>';
  }).join('')+'</div>';
}
function cashReport(branch='',assignee=''){
  const day=m.today();
  return financeReport(state,{branch,assignee,day,from:m.shiftDate(day,1-ui.period),through:m.shiftDate(day,ui.period-1)});
}
function ownerFilter(){
  return filterSelect('owner','Ответственный',[['mine',mine()?'Мои клиенты':'Вся команда'],
    ...m.people.filter(p=>p.branch).map(p=>[p.id,p.name]),...(mine()?[['','Вся команда']]:[])],ui.owner);
}
function pipelinePage(){
  const assignee=ui.owner==='mine'?mine():ui.owner;
  const scoped=selectDeals(state,{branch:ui.branch,assignee});
  const day=m.today();
  const from=m.shiftDate(day,1-ui.period);
  const upcomingEnd=m.shiftDate(day,ui.period-1);
  const filtered=selectDeals(state,{branch:ui.branch,assignee,stage:ui.stage}).filter(deal=>{
    if(ui.dealWindow==='revenue'&&(deal.paymentDate<from||deal.paymentDate>day))return false;
    if(ui.dealWindow==='upcoming'&&(deal.visitDate<day||deal.visitDate>upcomingEnd))return false;
    if(ui.dealWindow==='prospects'&&deal.stage!=='contact'&&deal.stage!=='interested')return false;
    return m.matches(m.byClient(state,deal.clientId),ui.query)||deal.service.toLowerCase().includes(ui.query.trim().toLowerCase());
  });
  const windowLabel={revenue:'Оплаты за '+ui.period+' дн.',upcoming:'Записи на '+ui.period+' дн.',prospects:'До записи'}[ui.dealWindow];
  const stageFilters=[['open','Открытые',scoped.filter(isOpen).length],...Object.entries(stages).map(([key,value])=>
    [key,value.label,scoped.filter(deal=>deal.stage===key).length]),['','Все',scoped.length]];
  const isBoard=ui.pipelineView==='board'&&!ui.dealWindow;
  const viewSwitch=button(ui.pipelineView==='board'?'Список':'Доска',ui.pipelineView==='board'?'checkList':'grid',
    'secondary small','switch-board',ui.dealWindow?'disabled':'');
  return heading('Воронка','',
    button('Добавить в воронку','plus','primary','new-deal'))+
    '<section class="panel"><div class="tab-wrap">'+tabs(stageFilters.map(([key,label,count])=>[key,label+' · '+count]),ui.stage,'deal-stage')+'</div><div class="toolbar">'+
    searchInput('Поиск по клиенту или услуге')+ownerFilter()+
    (windowLabel?button(windowLabel+' · сбросить','close','secondary small','clear-deal-window'):'')+viewSwitch+'</div>'+
    (isBoard?dealBoard(filtered):dealTable(filtered.slice(0,ui.dealLimit))+footerCount(filtered.length,ui.dealLimit,'more-deals'))+'</section>';
}
function dealBoard(list){
  const keys=ui.stage==='open'?['contact','interested','booked']:ui.stage?[ui.stage]:Object.keys(stages);
  return '<div class="board-wrap"><div class="deal-board" style="--columns:'+keys.length+'">'+keys.map(key=>{
    const deals=list.filter(deal=>deal.stage===key);
    const sum=deals.reduce((total,deal)=>total+((key==='paid'?deal.actual:deal.planned)??0),0);
    return '<section class="board-column" aria-label="'+s(stages[key].label)+'"><div class="board-head">'+
      '<span class="stage-mark '+stages[key].tone+'"></span><h2>'+s(stages[key].label)+'</h2><small>'+deals.length+'</small></div>'+
      '<div class="board-total">'+s(money(sum))+'</div>'+
      (deals.length?deals.slice(0,8).map(deal=>{
        const c=m.byClient(state,deal.clientId);
        const date=actionDate(deal);
        return '<article class="deal-card"><button class="identity" type="button" data-action="client" data-id="'+s(c.id)+'">'+clientAvatar(c)+
          '<span><strong>'+s(c.name)+'</strong><small>'+s(m.byBranch(c.branch).name)+'</small></span></button>'+
          '<div class="deal-card-body"><strong>'+s(money(key==='paid'?deal.actual:deal.planned))+'</strong><small>'+s(deal.service||'Услуга не указана')+'</small></div>'+
          '<div class="deal-card-footer">'+(isOpen(deal)?contactTime(date):'<small>'+s(key==='paid'?m.formatDate(deal.paymentDate):m.formatDate(deal.updated))+'</small>')+
          button('Открыть',null,'secondary small','edit-deal','data-id="'+s(deal.id)+'"')+'</div></article>';
      }).join(''):'<p class="board-empty">Нет записей</p>')+
      (deals.length>8?button('Все записи ('+deals.length+')',null,'secondary small','stage-list','data-id="'+key+'"'):'')+
      '</section>';
  }).join('')+'</div></div>';
}

function dealTable(list){
  if(!list.length)return empty('Записей по этим условиям нет','Измените фильтр или добавьте клиента в воронку.','funnel');
  return '<div class="table-wrap"><table class="deal-table"><thead><tr><th>Клиент</th><th>Этап</th><th>Следующий шаг</th><th>Сумма</th><th aria-label="Действия"></th></tr></thead><tbody>'+
    list.map(deal=>{
      const client=m.byClient(state,deal.clientId);
      const day=m.today();
      const date=actionDate(deal);
      const open=isOpen(deal);
      const details=open?nextStep(deal,day):deal.stage==='paid'?'Оплата '+m.formatDate(deal.paymentDate):deal.reason;
      const amount=deal.stage==='paid'?deal.actual:deal.planned;
      return '<tr><td><button type="button" class="identity" data-action="client" data-id="'+s(client.id)+'">'+clientAvatar(client)+'<span><strong>'+s(client.name)+'</strong><small>'+s(deal.service||m.byBranch(client.branch).name)+'</small></span></button></td>'+
        '<td>'+badge(deal.stage,stages)+'</td><td>'+(open?'<button type="button" class="task-title" data-action="deal-next" data-id="'+s(deal.id)+'">'+s(details)+'</button>':'<span>'+s(details)+'</span>')+
        (open?'<small class="cell-note '+(date&&date<day?'due-late':'')+'">'+s(date?m.formatDate(date):'Срок не задан')+' · '+s(m.byPerson(deal.assignee)?.name)+'</small>':'')+'</td>'+
        '<td class="nowrap"><strong>'+s(money(amount))+'</strong><small class="cell-note">'+(amount===null?'Сумма не указана':deal.stage==='paid'?'Факт':'План')+'</small></td>'+
        '<td class="row-end">'+button('Открыть',null,'secondary small','edit-deal','data-id="'+s(deal.id)+'"')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
const reportFields={
  detected:'Выявлено',issued:'Задач выдано',processed:'Клиентов обработано',connected:'Контакт состоялся',
  interested:'Согласились записаться',booked:'Записи подтверждены',declined:'Отказались',overdue:'Просрочено',conversion:'Записи от контактов'
};
function reportTable(title,firstColumn,items,keys){
  return '<section class="panel report-table"><div class="panel-head"><h2>'+s(title)+'</h2></div><div class="table-wrap"><table><thead><tr><th>'+s(firstColumn)+'</th>'+
    keys.map(key=>'<th>'+s(reportFields[key])+'</th>').join('')+'</tr></thead><tbody>'+
    items.map(([label,report])=>'<tr><td><strong>'+s(label)+'</strong></td>'+keys.map(key=>
      '<td>'+s(key==='conversion'?(report.connected?Math.round(100*report.contactBooked/report.connected)+'%':'—'):
        report[key]===null?'—':m.number(report[key]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></section>';
}
function analyticsPage(){
  const base={branch:ui.branch,days:ui.period,reason:ui.reportReason};
  const report=m.retentionReport(state,base);
  const cards=[
    ['detected','Клиентов выявлено','target','berry','Сейчас в подходящих сегментах'],
    ['issued','Задач выдано','checkList','stone','За выбранный период'],
    ['processed','Клиентов обработано','users','pink','С зафиксированным результатом'],
    ['connected','Контакт состоялся','phone','mint','Клиенты ответили'],
    ['interested','Согласились записаться','repeat','pink','Согласие или подтверждённая запись'],
    ['booked','Записи подтверждены','calendar','mint','Подтверждены вручную'],
    ['declined','Отказались','users','stone','В том числе от следующих звонков'],
    ['overdue','Задач просрочено','clock','berry','Открытые задачи со сроком в прошлом']
  ];
  const keys=['detected','issued','processed','connected','interested','booked','declined','overdue'];
  const branches=m.branches.filter(item=>!ui.branch||ui.branch===item.id);
  const personnel=m.people.filter(p=>p.branch&&(!ui.branch||m.assignedBranches(p).includes(ui.branch)));
  const cash=cashReport(ui.branch);
  return heading('Панель руководителя','',filterSelect('reportReason','Категория задач',[['','Все категории'],...segmentKeys.map(key=>[key,reasonTitle(key)])],ui.reportReason)+
    filterSelect('period','Период отчёта',[['7','7 дней'],['30','30 дней'],['90','90 дней']],String(ui.period)))+
    '<div class="stats finance-stats">'+cards.map(([key,label,ic,tone,detail])=>
      stat(label,report[key],detail,ic,tone,key==='detected'?'segment':key==='overdue'?'task-filter':'',key==='detected'?(ui.reportReason||'focus'):'late')).join('')+'</div>'+
    reportTable('Результаты по филиалам','Филиал',branches.map(branch=>[branch.name,m.retentionReport(state,{...base,branch:branch.id})]),keys)+
    reportTable('Работа администраторов','Администратор',personnel.map(p=>[p.name,m.retentionReport(state,{...base,assignee:p.id})]),[...keys.slice(1),'conversion'])+
    reportTable('Результаты по категориям','Причина',segmentKeys.map(reason=>[reasonTitle(reason),m.retentionReport(state,{...base,reason})]),keys)+
    (!ui.reportReason&&cash.paidCount?'<div class="analytics-trend">'+revenueChart(ui.branch,ui.period)+'</div>':'');
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
  app.innerHTML='<main class="login-page"><form id="login-form" class="panel login-card"><div class="panel-head"><div>'+logo+
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
      go(manager()?'analytics':'home');
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
      icon('chevron',15)+'</span>')).join('')+'</div></details>';
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
      (examples.length?'<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Филиал</th><th>Последний визит</th><th>Визитов</th><th>Действие</th></tr></thead><tbody>'+
      examples.map(c=>'<tr><td><strong>'+s(c.name)+'</strong><small class="cell-note">'+s(m.formatPhone(c.phone))+'</small></td><td>'+s(m.byBranch(c.branch).name)+
        '</td><td>'+s(c.lastVisit?m.longDate(c.lastVisit):'Нет данных')+'</td><td>'+s(c.visitCount??'—')+'</td><td>'+s(c.operation)+'</td></tr>').join('')+
      '</tbody></table></div>':empty('Новых данных для сохранения нет','','file'))+
      (result.issues.length?'<details class="import-issues" open><summary>Ошибки в строках</summary><ul>'+result.issues.slice(0,20).map(issue=>'<li>Строка '+issue.row+' · '+s(issue.reason)+'</li>').join('')+'</ul>'+
      (result.issues.length>20?'<p>Показано 20 из '+result.issues.length+' ошибок.</p>':'')+'</details>':'')+
      '<div class="table-footer"><span>Ошибки и дубли пропускаются. История контактов сохраняется.</span>'+
      button('Сохранить базу','check','primary','commit-import',!result.records.length||ui.importBusy?'disabled':'')+'</div></section>';
  }
  return heading('Импорт данных','',button('Тестовый CSV','download','secondary','template'))+
    '<section class="panel import-box"><div class="panel-head"><div><h2>Загрузка файла</h2><p>CSV, XLSX или XLS · до 15 МБ</p></div>'+iconBox('upload','berry')+'</div><div class="import-body">'+
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

const views={home,contacts:contactDeskPage,agent:agentPage,clients:clientsPage,tasks:tasksPage,pipeline:pipelinePage,visits:visitsPage,branches:branchesPage,analytics:analyticsPage,import:importPage,settings:settingsPage};
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
  const clientDeals=selectDeals(state).filter(deal=>deal.clientId===id);
  const openDeal=clientDeals.find(isOpen);
  const appointments=clientDeals.filter(deal=>deal.stage==='booked'&&deal.visitDate>=m.today());
  present(modalHead('Карточка клиента')+'<div class="drawer-body"><div class="client-profile">'+clientAvatar(c)+'<div><h3>'+s(c.name)+'</h3><p>'+s(m.byBranch(c.branch).label)+'</p></div>'+badge(m.retentionReason(state,c),reasons)+'</div><div class="client-actions">'+
    (c.callBlocked||c.invalidPhone?'':button('Зафиксировать звонок','phone','primary','call','data-id="'+s(id)+'"')+
    button('Новая задача','plus','secondary','new-task','data-id="'+s(id)+'"'))+
    (openDeal?button('Открыть воронку','funnel','secondary','edit-deal','data-id="'+s(openDeal.id)+'"'):
      c.callBlocked||c.invalidPhone?'':button('Добавить в воронку','funnel','secondary','new-deal','data-id="'+s(id)+'"'))+'</div>'+
    '<dl class="client-facts"><div><dt>Телефон</dt><dd>'+s(m.formatPhone(c.phone))+'</dd></div><div><dt>Последний визит</dt><dd>'+s(last.lastVisit?m.longDate(last.lastVisit):'Нет данных')+'</dd></div><div><dt>Дата регистрации</dt><dd>'+s(m.longDate(c.registered))+'</dd></div><div><dt>Последняя услуга</dt><dd>'+s(last.service||'—')+'</dd></div><div><dt>Завершённых визитов по выгрузке</dt><dd>'+s(c.visitCount??'—')+'</dd></div>'+
    '<div><dt>Следующая запись по выгрузке</dt><dd>'+s(m.longDate(c.nextBooking))+'</dd></div><div><dt>Последняя отмена</dt><dd>'+s(m.longDate(c.lastCancellation))+'</dd></div>'+
    '<div><dt>Отмен по выгрузке</dt><dd>'+s(c.cancelCount??'—')+'</dd></div></dl>'+
    (c.callBlocked||c.invalidPhone?'<div class="hint"><span>'+s(c.callBlocked?'Клиент просит больше не связываться.':'Телефон отмечен как неактуальный.')+'</span></div>':'')+
    (openDeal&&openDeal.stage!=='booked'?'<section class="drawer-section"><h3>Возврат клиента</h3><div class="drawer-line">'+iconBox('funnel','berry')+
      '<div><strong>'+s(stages[openDeal.stage].label)+'</strong><small>'+s(nextStep(openDeal,m.today()))+'</small></div><strong class="appointment-price">'+s(money(openDeal.planned))+'</strong></div></section>':'')+
    (appointments.length?'<section class="drawer-section"><h3>Предстоящие записи</h3>'+appointments.map(event=>'<div class="drawer-line">'+iconBox('calendar','mint')+'<div><strong>'+s(m.longDate(event.visitDate))+'</strong><small>'+s(event.service||'Повторный визит')+'</small></div><strong class="appointment-price">'+s(money(event.planned))+'</strong></div>').join('')+'</section>':'')+
    '<section class="drawer-section"><h3>История взаимодействий</h3>'+
    (visits.length?'<div class="timeline">'+visits.map(event=>'<article>'+iconBox(typeIcon[event.kind]||'file',event.kind==='call'?'berry':'stone')+'<div><strong>'+s(event.kind==='call'?m.outcomes[event.result]:event.kind==='payment'?'Оплата · '+money(event.amount):event.title)+'</strong><small>'+s(m.longDate(event.date))+(event.assignee?' · '+s(m.byPerson(event.assignee)?.name||''):'')+'</small>'+
    (event.note?'<p>'+s(event.note)+'</p>':'')+(event.kind==='payment'&&event.service?'<p>'+s(event.service)+'</p>':'')+(event.appointment?'<p>Запись на '+s(m.longDate(event.appointment))+(event.service?' · '+s(event.service):'')+(event.planned!==null&&event.planned!==undefined?' · '+s(money(event.planned)):'')+'</p>':'')+'</div></article>').join('')+'</div>':
    '<p class="secondary-text">Пока нет записей в истории.</p>')+'</section>'+
    (tasks.length?'<section class="drawer-section"><h3>Открытые задачи</h3>'+tasks.map(task=>'<div class="drawer-line">'+iconBox('checkList','berry')+'<div><button type="button" class="task-title" data-action="edit-task" data-id="'+s(task.id)+'">'+s(task.title)+'</button><small>'+s(m.byPerson(task.assignee)?.name)+' · '+s(m.longDate(task.due))+'</small></div>'+badge(task.status)+'</div>').join('')+'</section>':'')+'</div>','client',{id});
}
function outcomeFields(data={},options=[['','Выберите результат'],...Object.entries(m.outcomes)]){
  return '<div class="result-fields">'+field('Результат звонка',select('result',options,data.result||'',true))+
    '<div class="booking-fields form-grid">'+field('Дата повторной записи',input('appointment',data.appointment||'','date','required'))+
    field('Время',input('visitTime',data.visitTime||'','time'))+
    field('Услуга',input('service',data.service||'','text','maxlength="120" placeholder="Например, маникюр"'))+
    field('Плановая сумма, ₽',input('plannedInput',data.plannedInput??moneyInput(data.planned),'text','maxlength="16" inputmode="decimal" placeholder="Например, 2 450"'))+'</div></div>';
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
    field('Название задачи',input('title',d.title,'text','required maxlength="140" placeholder="Например, предложить повторный визит" autofocus'),'wide')+
    field('Ответственный',select('assignee',assignees().map(p=>[p.id,p.name]),d.assignee,true))+
    field('Срок выполнения',input('due',d.due,'date','required'))+
    field('Время задачи',input('dueTime',d.dueTime||'','time'))+
    field('Приоритет',select('priority',Object.entries(priorities).map(([key,value])=>[key,value.label]),d.priority||'normal',true))+
    (task?'<p class="secondary-text wide">Причина: '+s(reasonTitle(task.reason))+'</p>':'')+
    field('Статус',select('status',Object.entries(m.statuses).map(([key,value])=>[key,value.label]),d.status,true),'wide')+
    outcomeFields(d)+followUpFields()+field('Комментарий','<textarea name="note" maxlength="1200" rows="3" placeholder="Детали для следующего контакта">'+s(d.note)+'</textarea>','wide')+
    (task?.activity?.length?'<details class="wide activity"><summary>История задачи</summary><ul>'+task.activity.slice().reverse().slice(0,20).map(event=>
      '<li>'+s(m.formatDate(event.date))+' · '+s(event.title)+(event.actor?' · '+s(m.byPerson(event.actor)?.name||event.actor):'')+'</li>').join('')+'</ul></details>':'')+
    '<div class="form-error wide" role="alert" hidden></div></div>'+modalFoot(task?'Сохранить задачу':'Создать задачу',task?'check':'plus')+'</form>','task',{id,clientId});
  toggleOutcome();
}
function followUpFields(data={}){
  const day=m.today();
  return '<div class="field-group" data-follow-up hidden>'+
    field('Следующий контакт',input('followUp',data.followUp||m.shiftDate(day,1),'date','min="'+day+'" required'))+
    field('Время повторного звонка',input('followUpTime',data.followUpTime||'','time'))+'</div>';
}
function quickContact(id,taskId='',assigned=''){
  const client=m.byClient(state,id);
  const fromClient=modal?.type==='client'&&dialog.open;
  const task=taskId?state.tasks.find(item=>item.id===taskId):
    fromClient?m.queue(state,{assignee:mine(),status:'open'}).find(item=>item.clientId===id):null;
  if(!client||client.callBlocked||client.invalidPhone)return;
  const assignee=assigned||task?.assignee||mine()||defaultAssignee(client.branch);
  const active=state.opportunities.find(item=>item.clientId===id&&isOpen(item));
  const options=[['','Выберите результат'],...Object.entries(m.outcomes)];
  present(modalHead('Результат контакта',client.name+' · '+m.formatPhone(client.phone))+
    '<form id="quick-contact-form"><div class="modal-body form-grid">'+
    (task?'<div class="contact-reference wide">'+icon('checkList',17)+'<span>'+s(task.title)+'</span></div>':'')+
    outcomeFields({planned:active?.planned,service:active?.service||m.lastKnownVisit(state,client).service},options)+
    followUpFields()+
    field('Ответственный',select('assignee',assignees().map(p=>[p.id,p.name]),assignee,true),'wide')+
    field('Комментарий','<textarea name="note" maxlength="1200" rows="2" placeholder="Договорённости"></textarea>','wide')+
    '<div class="form-error wide" role="alert" hidden></div></div>'+modalFoot('Сохранить')+'</form>','contact',{id,taskId:task?.id||'',fromClient});
  toggleOutcome();
}
function batchModal(){
  const branch=ui.branch||person().branch||m.branches[0].id;
  const assignee=defaultAssignee(branch);
  const day=m.today();
  present(modalHead('Назначить обзвон')+'<form id="batch-form"><div class="modal-body form-grid">'+
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
  const size=Math.min(Number(count.value),m.availableForContact(state,branch.value,group.value).length);
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

function dealModal(id='',clientId='',nextStage=''){
  const deal=state.opportunities.find(item=>item.id===id);
  const client=m.byClient(state,deal?.clientId||clientId);
  const day=m.today();
  const newBooking=!deal&&nextStage==='booked';
  const available=state.clients.filter(c=>(!ui.branch||c.branch===ui.branch)&&
    !state.opportunities.some(item=>item.clientId===c.id&&isOpen(item)&&(!newBooking||item.stage==='booked')))
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const assignee=deal?.assignee||mine()||defaultAssignee(client?.branch||ui.branch)||assignees()[0]?.id;
  const options=Object.entries(stages).filter(([key])=>deal?.stage!=='paid'||key==='paid').map(([key,value])=>[key,value.label]);
  const clientField=client
    ? '<input type="hidden" name="clientId" value="'+s(client.id)+'">'
    : field('Клиент',select('clientId',[['','Выберите клиента'],...available.map(c=>[c.id,c.name+' · '+m.byBranch(c.branch).name])],'',true),'wide');
  const planned=field('Плановая сумма, ₽',input('plannedInput',moneyInput(deal?.planned),'text','maxlength="16" inputmode="decimal" placeholder="Например, 2 450"'));
  const group=(type,content)=>'<div class="field-group '+type+'" data-deal-fields="'+type+'">'+content+'</div>';
  const backToClient=modal?.type==='client'&&dialog.open?modal.id:'';
  const due=nextStage&&nextStage!==deal?.stage&&deal?.due<day?day:deal?.due||day;
  present(modalHead(newBooking?'Добавить запись':nextStage==='paid'?'Визит и оплата':deal?'Этап воронки':'Добавить в воронку',client?.name||'Выберите клиента и задайте следующий шаг.')+
    '<form id="deal-form"><div class="modal-body form-grid">'+clientField+
    field('Этап',select('stage',options,nextStage||deal?.stage||'contact',true))+
    field('Ответственный','<span class="select-control"><select name="assignee" required></select>'+icon('chevron',15)+'</span>')+
    field('Услуга',input('service',deal?.service||client?.service,'text','maxlength="120" placeholder="Например, маникюр с покрытием"'))+planned+
    group('outreach',field('Срок следующего шага',input('due',due,'date')))+
    group('visit',field('Дата визита',input('visitDate',deal?.visitDate||day,'date','required'))+
      field('Время',input('visitTime',deal?.visitTime||'','time')))+
    group('cash',field('Фактически оплачено, ₽',input('actualInput',moneyInput(deal?.actual??deal?.planned),'text','required maxlength="16" inputmode="decimal"'))+
      field('Дата оплаты',input('paymentDate',deal?.paymentDate||day,'date','required max="'+day+'"')))+
    group('lost',field('Причина закрытия',input('reason',deal?.reason||(nextStage==='lost'?'Клиент не пришёл':''),'text','required maxlength="240" placeholder="Например, клиент изменил планы"'),'wide'))+
    field('Комментарий','<textarea name="note" maxlength="1200" rows="2" placeholder="Договорённости и детали">'+s(deal?.note)+'</textarea>','wide')+
    '<div class="form-error wide" role="alert" hidden></div></div>'+modalFoot(deal?'Сохранить':'Добавить')+'</form>',
    'deal',{id,backToClient,newBooking});
  toggleDealFields();
}
function toggleDealFields(){
  const form=dialog.querySelector('#deal-form');
  if(!form)return;
  const {value:stage}=form.elements.stage;
  const visible={
    outreach:stage==='contact'||stage==='interested',
    visit:stage==='booked'||stage==='paid',
    cash:stage==='paid',
    lost:stage==='lost'
  };
  for(const group of form.querySelectorAll('[data-deal-fields]')){
    group.hidden=!visible[group.dataset.dealFields];
    for(const field of group.querySelectorAll('input'))field.disabled=group.hidden;
  }
  const visit=form.elements.visitDate;
  if(stage==='paid')visit.max=m.today();
  else visit.removeAttribute('max');
  if(modal.newBooking&&stage==='booked')visit.min=m.today();
  else visit.removeAttribute('min');
}

function toggleOutcome(form=dialog.querySelector('form')){
  if(!form) return;
  const status=form.elements.namedItem('status');
  const result=form.elements.namedItem('result');
  const selected=!status||status.value==='done';
  const booked=selected&&result.value==='booked';
  form.querySelector('.result-fields').hidden=!selected;
  result.disabled=!selected;
  form.querySelector('.booking-fields').hidden=!booked;
  form.elements.appointment.disabled=!booked;
  form.elements.service.disabled=!booked;
  form.elements.visitTime.disabled=!booked;
  form.elements.plannedInput.disabled=!booked;
  const next=form.querySelector('[data-follow-up]');
  if(next){
    const historical=form.id==='task-form'&&modal?.type==='task'&&state.tasks.some(task=>task.id===modal.id&&task.status==='done'&&task.result===result.value);
    next.hidden=!selected||!result.value||terminalResults.has(result.value)||historical;
    form.elements.followUp.disabled=next.hidden;
    form.elements.followUpTime.disabled=next.hidden;
    form.elements.followUpTime.required=!next.hidden&&result.value==='callback';
    form.elements.appointment.min=m.today();
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
    go('clients',{segment:'focus'});
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
  const id=element.dataset.id||'';
  if(element.tagName==='A'&&(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return;
  event.preventDefault();
  switch(element.dataset.action){
    case 'navigate': go(id);break;
    case 'nav-toggle': ui.mobileNav=!ui.mobileNav;render();break;
    case 'theme': ui.theme=ui.theme==='light'?'dark':'light';savePrefs();applyTheme();render();document.querySelector('[data-action="theme"]')?.focus();break;
    case 'segment': go('clients',{segment:id});break;
    case 'task-filter': go('tasks',{taskWhen:id});break;
    case 'status': ui.taskStatus=id;ui.taskWhen='';ui.taskLimit=15;render();document.querySelector('[data-action="status"][aria-pressed="true"]')?.focus();break;
    case 'more-clients': ui.clientLimit+=12;render();break;
    case 'more-tasks': ui.taskLimit+=15;render();break;
    case 'more-deals': ui.dealLimit+=12;render();break;
    case 'switch-board': ui.pipelineView=ui.pipelineView==='board'?'list':'board';savePrefs();render();break;
    case 'stage-list': ui.pipelineView='list';ui.stage=id;ui.dealLimit=12;savePrefs();render();break;
    case 'open-pipeline': go('pipeline',{stage:id,owner:'',dealWindow:element.dataset.window||''});break;
    case 'clear-deal-window': ui.dealWindow='';render();break;
    case 'pipeline-branch': ui.branch=id;savePrefs();go('pipeline',{owner:''});break;
    case 'deal-stage': ui.stage=id;ui.dealWindow='';ui.dealLimit=12;render();document.querySelector('[data-action="deal-stage"][aria-pressed="true"]')?.focus();break;
    case 'new-deal': dealModal('',id);break;
    case 'edit-deal': dealModal(id);break;
    case 'deal-next': {
      const deal=state.opportunities.find(item=>item.id===id);
      if(deal)dealModal(id,'',deal.stage==='booked'&&deal.visitDate>m.today()?'booked':stages[deal.stage].next);
      break;
    }
    case 'open-branch': ui.branch=id;savePrefs();go('clients');break;
    case 'profile': profileModal();break;
    case 'switch-profile': {
      if(serverMode||!m.byPerson(id,rawState))break;
      contactDrafts.clear();ui.profile=id;ui.branch='';useSnapshot(rawState);savePrefs();closeModal();go(manager()?'analytics':'home');break;
    }
    case 'logout': void logout();break;
    case 'client': clientModal(id);break;
    case 'new-task': taskModal('',id);break;
    case 'edit-task': taskModal(id);break;
    case 'call': quickContact(id);break;
    case 'quick-contact':
    case 'desk-client': openContactDesk(id);break;
    case 'desk-tab': selectDeskTab(id);break;
    case 'desk-move': moveDesk(id);break;
    case 'copy-desk-phone': void copyDeskPhone(id);break;
    case 'agent-step': applyAgentStep(id);break;
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
    case 'new-booking': dealModal('','','booked');break;
    case 'visit-pay': dealModal(id,'','paid');break;
    case 'visit-missed': dealModal(id,'','lost');break;
    case 'week-next': ui.visitWeek++;ui.visitDay='';render();break;
    case 'week-prev': ui.visitWeek--;ui.visitDay='';render();break;
    case 'week-current': ui.visitWeek=0;ui.visitDay='';render();break;
    case 'visit-day': ui.visitDay=ui.visitDay===id?'':id;render();break;
    case 'work-pipeline': go('pipeline',{stage:id});break;
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
  if(event.target.dataset.filter==='query'){ui.query=event.target.value;ui.clientLimit=12;ui.taskLimit=15;ui.dealLimit=12;render(true);}
});
document.addEventListener('change',event=>{
  const field=event.target;
  if(field.id==='agent-option'){
    const {row}=deskSelection();if(row){deskDraft(row).values.option=field.value;refreshAgentSuggestion();}
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
    if(field.name==='stage')toggleDealFields();
    if(field.name==='clientId'&&['task-form','deal-form'].includes(field.form?.id)&&manager()){
      const client=m.byClient(state,field.value);
      const assignee=field.form.elements.assignee;
      if(!m.assignedBranches(m.byPerson(assignee.value)).includes(client?.branch))assignee.value=defaultAssignee(client?.branch)||'';
    }
    if(field.name==='clientId'&&modal.newBooking){
      const booking=state.opportunities.find(deal=>deal.clientId===field.value&&isOpen(deal));
      const client=m.byClient(state,field.value);
      const elements=field.form.elements;
      elements.service.value=booking?.service||client?.service||'';
      elements.plannedInput.value=moneyInput(booking?.planned);
      elements.assignee.value=booking?.assignee||mine()||defaultAssignee(client?.branch)||assignees()[0]?.id;
    }
    return;
  }
  const filter=field.dataset.filter;
  if(!filter||filter==='query')return;
  ui[filter]=filter==='period'?Number(field.value):field.value;
  ui.clientLimit=12;ui.taskLimit=15;ui.dealLimit=12;
  if(filter==='fallback')updatePreview();
  if(filter==='branch')savePrefs();
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
    if(current.type==='deal'){
      await run({type:'save-deal',values:{...data,id:current.id},mergeBooking:current.newBooking});
      if(current.backToClient)clientModal(current.backToClient);
      else closeModal();
      notify(current.newBooking&&data.stage==='booked'?'Клиент записан':current.id?'Воронка обновлена':'Клиент добавлен в воронку');
    }
    if(current.type==='task'){
      await run({type:'save-task',task:{...data,id:current.id,appointment:data.appointment||'',service:data.service||''}});
      if(current.clientId)clientModal(current.clientId);
      else closeModal();
      notify(current.id?'Задача обновлена':'Задача создана');
    }
    if(current.type==='contact'){
      await run({type:'record-contact',clientId:current.id,taskId:current.taskId,values:data});
      if(current.fromClient)clientModal(current.id);
      else closeModal();
      const message=data.result==='booked'?'Клиент записан':terminalResults.has(data.result)?'Результат сохранён':
        'Следующий контакт: '+m.formatDate(data.followUp);
      notify(message);
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
    account=(await repository.session()).user;
    if(account){ui.profile=account.id;useSnapshot(await repository.read());if(!location.hash&&manager())ui.page='analytics';render();}
    else renderLogin();
  }else{useSnapshot(await repository.read());if(!location.hash&&manager())ui.page='analytics';render();}
}
catch {app.innerHTML='<div class="boot" role="alert">Не удалось открыть хранилище. Проверьте разрешения браузера и перезагрузите страницу.</div>';}
