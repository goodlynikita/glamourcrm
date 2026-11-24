import {icon} from './icons.mjs';
import * as m from './model.mjs';
import {readFile,previewRows,sampleCsv} from './importer.mjs';
import {repository,storageKey} from './repository.mjs';
import {actionDate,financeReport,isOpen,money,moneyInput,nextStep,selectDeals,stages} from './finance.mjs';

const app=document.querySelector('#app');
const dialog=document.querySelector('#dialog');
const toastEl=document.querySelector('#toast');
const preferencesKey='glamour-crm-preferences';
let savedPrefs={};
try {savedPrefs=JSON.parse(localStorage.getItem(preferencesKey)||'{}');} catch {}
const routes={
  home:['Рабочий стол','grid'],clients:['Клиенты','users'],tasks:['Задачи','checkList'],
  pipeline:['Воронка','funnel'],visits:['Записи','calendar'],branches:['Филиалы','building'],analytics:['Панель руководителя','chart'],import:['Импорт данных','upload']
};
const pageFromHash=()=>Object.hasOwn(routes,location.hash.slice(1))?location.hash.slice(1):'home';
const ui={
  page:pageFromHash(),theme:savedPrefs.theme==='dark'?'dark':'light',profile:m.byPerson(savedPrefs.profile)?.id||'alina',
  branch:m.byBranch(savedPrefs.branch)?.id||'',query:'',segment:'',taskStatus:'open',taskWhen:'',owner:'mine',
  homeFilter:'ready',homeLimit:8,visitWeek:0,visitDay:'',pipelineView:savedPrefs.pipelineView==='list'?'list':'board',
  clientSort:'attention',period:30,stage:'open',dealWindow:'',dealLimit:12,mobileNav:false,importFile:null,importPreview:null,importError:'',
  importBusy:false,fallback:m.byBranch(savedPrefs.branch)?.id||'center',clientLimit:12,taskLimit:15
};
let state, modal, toastTimer;
const s=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const attr=(name,value)=>' '+name+'="'+s(value)+'"';
const cap=text=>text.charAt(0).toUpperCase()+text.slice(1);
const person=()=>m.byPerson(ui.profile);
const mine=()=>ui.profile==='manager'?'':ui.profile;
const opts=(items,value)=>items.map(([key,label])=>'<option value="'+s(key)+'"'+(key===value?' selected':'')+'>'+s(label)+'</option>').join('');
const branchOpts=(current,all)=>opts([...(all?[['','Все филиалы']]:[]),...m.branches.map(b=>[b.id,b.label])],current);
const tag=(label,tone)=>'<span class="tag '+tone+'"><span></span>'+s(label)+'</span>';
const badge=(key,list=m.statuses)=>tag(list[key].label,list[key].tone);
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
async function run(command){
  const response=await repository.dispatch(command);
  state=response.state;
  render();
  return response.value;
}
function resetNav(){
  ui.query='';ui.segment='';ui.taskStatus='open';ui.taskWhen='';ui.owner='mine';ui.clientSort='attention';
  ui.clientLimit=12;ui.taskLimit=15;ui.dealLimit=12;ui.stage='open';ui.dealWindow='';ui.homeFilter='ready';ui.homeLimit=8;ui.visitWeek=0;ui.visitDay='';ui.mobileNav=false;
}
function go(page,filters={}){
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
    try {state=await repository.read();if(!dialog.open)render();}
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
    '<nav aria-label="Разделы"><p class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p>'+navEntry('home')+navEntry('clients')+navEntry('tasks',taskCount)+navEntry('pipeline')+navEntry('visits')+navEntry('branches')+
    '<p class="nav-caption tools-caption">УПРАВЛЕНИЕ</p>'+navEntry('analytics')+navEntry('import')+'</nav>'+
    '<div class="sidebar-foot"><div class="demo"><span></span> Деморежим</div><button class="profile" type="button" data-action="profile" aria-label="Сменить демопрофиль">'+avatar(p.name,p.id==='manager'?1:0)+'<span class="profile-text"><strong>'+s(p.name)+'</strong><small>'+s(p.role)+'</small></span>'+icon('chevron',16)+'</button></div></aside>'+
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
    return '<tr><td><button type="button" class="identity" data-action="client" data-id="'+s(client.id)+'">'+clientAvatar(client)+'<span><strong>'+s(client.name)+'</strong><small>'+s(m.formatPhone(client.phone))+'</small></span></button></td><td><button type="button" class="task-title" data-action="edit-task" data-id="'+s(task.id)+'">'+s(task.title)+'</button></td>'+
      '<td>'+s(m.byPerson(task.assignee)?.name||'—')+'</td>'+
      '<td class="nowrap">'+due(task)+'</td><td>'+badge(task.status)+(task.result?'<small class="cell-note">'+s(m.outcomes[task.result])+'</small>':'')+'</td><td class="row-end"><button class="row-button" type="button" data-action="edit-task" data-id="'+s(task.id)+'" aria-label="'+s('Открыть задачу '+task.title)+'">'+icon('right',16)+'</button></td></tr>';
  }).join('');
  return '<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Задача</th>'+'<th>Ответственный</th>'+'<th>Срок</th><th>Статус</th><th aria-label="Действия"></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
const categories=[
  ['lost','90+ дней','var(--chart-berry)'],['attention','45–89 дней','var(--chart-rose)'],
  ['unknown','Нет данных','var(--chart-pink)'],['active','До 45 дней','var(--chart-sage)']
];
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
      const gap=m.clientSegment(state,c);
      return '<tr><td><button class="identity" type="button" data-action="client" data-id="'+s(c.id)+'">'+clientAvatar(c)+
        '<span><strong>'+s(c.name)+'</strong><small>'+s(m.byBranch(c.branch).name)+(gap==='active'?'':' · '+s(m.segments[gap].label))+'</small></span></button></td>'+
        '<td><span class="work-action">'+s(summary)+'</span><small class="cell-note">'+s(m.byPerson(row.assignee)?.name)+'</small></td>'+
        '<td class="nowrap">'+contactTime(row.due)+'</td><td class="row-end">'+button('Результат','phone','secondary small','quick-contact',
          'data-id="'+s(c.id)+'" data-task="'+s(row.task?.id)+'" data-assignee="'+s(row.assignee)+'"')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
function compactPipeline(){
  const incoming=selectDeals(state,{branch:ui.branch,assignee:mine(),stage:'open'});
  const total=incoming.reduce((sum,item)=>sum+(item.planned??0),0);
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
  const contacts={ready,late,all:rows}[ui.homeFilter];
  const bookings=branchBookings().filter(deal=>deal.visitDate>=day&&deal.visitDate<=m.shiftDate(day,6));
  const revenue=cashReport(ui.branch);
  const eligible=m.metrics(state,ui.branch).attention;
  return heading('Рабочий стол','',
    '<span class="date-chip">'+icon('calendar',17)+s(cap(m.formatDate(day,{weekday:'long',day:'numeric',month:'long'})))+'</span>'+
    button('Новая задача','plus','primary','new-task'))+
    '<section class="stats work-stats" aria-label="Основные показатели">'+
    stat('Контакты к сроку',ready.length,late.length?'Просрочено: '+late.length:'На сегодня','phone','berry','home-filter','ready')+
    stat('Требуют внимания',eligible,'45+ дней или неизвестен визит','target','pink','segment','focus')+
    stat('Записи на 7 дней',bookings.length,bookings.length?money(bookings.reduce((sum,deal)=>sum+(deal.planned??0),0)):'Расписание','calendar','stone','navigate','visits')+
    stat('Выручка',money(revenue.revenue),'Оплачено за '+ui.period+' дн.','wallet','mint','navigate','analytics')+'</section>'+
    '<div class="dashboard-grid work-grid"><section class="panel queue-panel"><div class="panel-head"><div><h2>Очередь контактов</h2><p>'+(mine()?'Мои клиенты':'Вся команда')+'</p></div>'+
    button('Назначить обзвон','plus','secondary small','batch')+'</div><div class="queue-tabs">'+
    tabs([['ready','К сроку '+ready.length],['late','Просрочены '+late.length],['all','Все '+rows.length]],ui.homeFilter,'home-filter')+'</div>'+
    contactTable(contacts.slice(0,ui.homeLimit))+(contacts.length>ui.homeLimit?footerCount(contacts.length,ui.homeLimit,'more-contacts'):'')+'</section>'+compactPipeline()+'</div>'+
    '<div class="dashboard-grid work-grid">'+revenueChart(ui.branch,ui.period)+upcomingPanel(bookings)+'</div>';
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
    &&(!ui.segment||(ui.segment==='focus'?m.clientSegment(state,c)!=='active':m.clientSegment(state,c)===ui.segment)));
  list=list.map(client=>({...client,...m.lastKnownVisit(state,client)}));
  list.sort((a,b)=>ui.clientSort==='name'?a.name.localeCompare(b.name,'ru'):
    (a.lastVisit||'9999').localeCompare(b.lastVisit||'9999')||a.name.localeCompare(b.name,'ru'));
  const items=list.slice(0,ui.clientLimit).map(c=>{
    const gap=c.lastVisit?m.dateDiff(m.today(),c.lastVisit):null;
    return '<tr><td><button class="identity" type="button" data-action="client" data-id="'+s(c.id)+'">'+clientAvatar(c)+'<span><strong>'+s(c.name)+'</strong><small>'+s(m.formatPhone(c.phone))+'</small></span></button></td>'+
      '<td>'+s(m.byBranch(c.branch).name)+'</td><td>'+s(c.lastVisit?m.longDate(c.lastVisit):'Нет данных')+(gap!==null?'<small class="cell-note">'+m.number(gap)+' дн. назад</small>':'')+'</td><td>'+badge(m.clientSegment(state,c),m.segments)+'</td>'+
      '<td class="row-end"><button class="row-button" type="button" data-action="client" data-id="'+s(c.id)+'" aria-label="'+s('Открыть карточку '+c.name)+'">'+icon('right',16)+'</button></td></tr>';
  }).join('');
  return heading('Клиенты','',button('Импорт данных','upload','primary','navigate','data-id="import"'))+
    '<section class="panel"><div class="toolbar">'+searchInput('Поиск по имени или телефону')+
    filterSelect('segment','Сегмент клиентов',[['','Все сегменты'],['focus','Требуют внимания'],...categories.map(([key,label])=>[key,label])],ui.segment)+
    filterSelect('clientSort','Порядок сортировки',[['attention','По давности визита'],['name','По имени']],ui.clientSort)+'</div>'+
    (list.length?'<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Филиал</th><th>Последний визит</th><th>Сегмент</th><th aria-label="Действия"></th></tr></thead><tbody>'+items+'</tbody></table></div>':
    empty('Клиенты не найдены','Попробуйте изменить поиск или фильтры.','users'))+footerCount(list.length,ui.clientLimit,'more-clients')+'</section>';
}
function tasksPage(){
  const assignee=ui.owner==='mine'?mine():ui.owner;
  const list=m.queue(state,{branch:ui.branch,assignee,status:ui.taskStatus,when:ui.taskWhen,query:ui.query});
  return heading('Задачи','',button('Новая задача','plus','primary','new-task'))+
    '<section class="panel"><div class="tab-wrap">'+tabs([['open','Открытые'],['new','К выполнению'],['progress','В работе'],['done','Выполненные'],['','Все']],ui.taskStatus,'status')+'</div><div class="toolbar">'+searchInput('Поиск по задаче или клиенту')+
    filterSelect('owner','Ответственный',[...(mine()?[['mine','Мои задачи']]:[['mine','Вся команда']]),...m.people.filter(p=>p.branch).map(p=>[p.id,p.name]),...(mine()?[['','Вся команда']]:[])],ui.owner)+
    filterSelect('taskWhen','Срок задачи',[['','Любой срок'],['today','Сегодня'],['late','Просрочено']],ui.taskWhen)+'</div>'+
    taskTable(list.slice(0,ui.taskLimit))+footerCount(list.length,ui.taskLimit,'more-tasks')+'</section>';
}
function branchesPage(){
  const list=m.branches.filter(b=>!ui.branch||b.id===ui.branch);
  return heading('Филиалы','')+'<div class="branch-grid">'+list.map(b=>{
    const data=m.metrics(state,b.id);
    const admin=m.people.find(p=>p.branch===b.id);
    return '<article class="panel branch-card"><div class="branch-head">'+iconBox('building',b.color==='pink'?'pink':'berry')+'<div><h2>'+s(b.name)+'</h2><p>'+s(b.label)+'</p></div></div><div class="branch-admin">'+avatar(admin.name,1)+'<div><strong>'+s(admin.name)+'</strong><small>Администратор</small></div></div><dl><div><dt>Клиенты</dt><dd>'+m.number(data.total)+'</dd></div><div><dt>Требуют внимания</dt><dd>'+m.number(data.attention)+'</dd></div><div><dt>Открытые задачи</dt><dd>'+m.number(data.open)+'</dd></div></dl>'+button('Клиенты филиала',null,'secondary','open-branch','data-id="'+b.id+'"')+'</article>';
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
function valueDetail(count,label,missing){
  return m.number(count)+' '+label+(missing?' · без суммы: '+m.number(missing):'');
}
function analyticsPage(){
  const stats=m.metrics(state,ui.branch,ui.period);
  const cash=cashReport(ui.branch);
  const list=m.branches.filter(b=>!ui.branch||b.id===ui.branch);
  const people=m.people.filter(p=>p.branch&&(!ui.branch||p.branch===ui.branch));
  const rows=selectDeals(state,{branch:ui.branch});
  const instant=rows.filter(deal=>isOpen(deal)).slice(0,4);
  const today=m.today();
  const paidStart=m.shiftDate(today,1-ui.period);
  const paidEnd=today;
  const funnelStages=['contact','interested','booked','paid','lost'];
  const rowsByStage=funnelStages.map(key=>[key,rows.filter(deal=>deal.stage===key&&(key!=='paid'||(deal.paymentDate>=paidStart&&deal.paymentDate<=paidEnd)))]);
  const largest=Math.max(1,...rowsByStage.map(([,items])=>items.length));
  const period='Последние '+ui.period+' дн.';
  return heading('Панель руководителя','',
    filterSelect('period','Период отчёта',[['7','Период · 7 дней'],['30','Период · 30 дней'],['90','Период · 90 дней']],String(ui.period)))+
    '<div class="stats finance-stats">'+stat('Выручка по воронке',money(cash.revenue),period+' · оплат: '+cash.paidCount,'wallet','mint','open-pipeline','paid','revenue')+
    stat('Ближайшие записи',money(cash.booked),'Следующие '+ui.period+' дн. · '+valueDetail(cash.bookedCount,'зап.',cash.bookedUnpriced),'calendar','pink','open-pipeline','booked','upcoming')+
    stat('Потенциал до записи',money(cash.potential),valueDetail(cash.potentialCount,'активных',cash.potentialUnpriced),'target','berry','open-pipeline','open','prospects')+
    stat('Средний чек',money(cash.average),period+' · по оплаченным визитам','chart','stone')+'</div>'+
    '<div class="analytics-grid cash-grid"><section class="panel"><div class="panel-head"><div><h2>Воронка возврата</h2><p>Суммы по текущим этапам, оплаты за выбранный период</p></div>'+button('Вся воронка',null,'secondary small','open-pipeline','data-id="open"')+'</div><div class="funnel-rows">'+
    rowsByStage.map(([key,items])=>{
      const amount=items.reduce((sum,deal)=>sum+((key==='paid'?deal.actual:deal.planned)??0),0);
      const missing=items.filter(deal=>(key==='paid'?deal.actual:deal.planned)===null).length;
      return '<button class="funnel-row" data-action="open-pipeline" data-id="'+key+'" data-window="'+(key==='paid'?'revenue':'')+'" type="button"><span class="funnel-info"><strong>'+s(stages[key].label)+'</strong><small>'+valueDetail(items.length,'клиент.',missing)+'</small></span>'+
        '<span class="funnel-track"><span class="funnel-fill '+stages[key].tone+'" style="--fill:'+Math.round(100*items.length/largest)+'%"></span></span><strong class="funnel-value">'+s(money(amount))+'</strong></button>';
    }).join('')+'</div></section>'+
    '<section class="panel"><div class="panel-head"><div><h2>Кому уделить внимание</h2><p>'+s(cash.overdue?'Просрочено шагов: '+m.number(cash.overdue):'Ближайшие шаги по клиентам')+'</p></div>'+iconBox('checkList','pink')+'</div><div class="priority-list">'+
    (instant.length?instant.map(deal=>{
      const c=m.byClient(state,deal.clientId);
      return '<button class="priority-item" type="button" data-action="deal-next" data-id="'+s(deal.id)+'">'+clientAvatar(c)+'<span><strong>'+s(c.name)+'</strong><small>'+s(nextStep(deal,today))+' · '+s(actionDate(deal)?m.formatDate(actionDate(deal)):'без срока')+'</small></span><strong>'+s(money(deal.planned))+'</strong></button>';
    }).join(''):empty('Все шаги выполнены','Новые действия появятся после добавления клиентов.','checkList'))+
    '</div></section></div>'+
    '<div class="analytics-grid cash-grid"><section class="panel"><div class="panel-head"><div><h2>Деньги по филиалам</h2><p>В рублях, по данным воронки</p></div>'+iconBox('building','berry')+'</div><div class="table-wrap"><table><thead><tr><th>Филиал</th><th>Оплачено</th><th>На записях</th><th>До записи</th></tr></thead><tbody>'+
    list.map(b=>{const v=cashReport(b.id);return '<tr><td><button class="task-title" type="button" data-action="pipeline-branch" data-id="'+b.id+'">'+s(b.name)+'</button></td><td>'+s(money(v.revenue))+'</td><td>'+s(money(v.booked))+'</td><td>'+s(money(v.potential))+'</td></tr>';}).join('')+
    '</tbody></table></div></section><section class="panel"><div class="panel-head"><div><h2>Работа команды</h2><p>Оплаты и задачи · звонков '+m.number(stats.contacts)+'</p></div>'+iconBox('users','stone')+'</div><div class="team">'+
    people.map((p,i)=>{const v=m.metrics(state,ui.branch,ui.period,today,p.id);const r=cashReport(ui.branch,p.id);return '<div class="team-member">'+avatar(p.name,i)+'<span><strong>'+s(p.name)+'</strong><small>Задач выполнено: '+v.completed+' · открыто: '+v.open+'</small></span><strong title="Оплачено">'+s(money(r.revenue))+'</strong></div>';}).join('')+
    '</div></section></div><div class="analytics-trend">'+revenueChart(ui.branch,ui.period)+'</div>';
}
function importPage(){
  const file=ui.importFile;
  const result=ui.importPreview;
  const error=ui.importError;
  const previews=result?.records.slice(0,8)??[];
  let preview='';
  if(result){
    preview='<section class="panel import-preview"><div class="panel-head"><div><h2>Предпросмотр импорта</h2><p>'+s(file.name)+(file.sheet?' · Лист «'+s(file.sheet)+'»':'')+'</p></div></div><div class="import-counters">'+
      tag(m.number(result.records.length)+' к добавлению','green')+tag(m.number(result.duplicates)+' дублей','slate')+tag(m.number(result.issues.length)+' с ошибками',result.issues.length?'red':'slate')+'</div>'+
      (previews.length?'<div class="table-wrap"><table><thead><tr><th>Клиент</th><th>Филиал</th><th>Последний визит</th><th>Дата регистрации</th></tr></thead><tbody>'+
      previews.map(c=>'<tr><td><strong>'+s(c.name)+'</strong><small class="cell-note">'+s(m.formatPhone(c.phone))+'</small></td><td>'+s(m.byBranch(c.branch).name)+'</td><td>'+s(c.lastVisit?m.longDate(c.lastVisit):'Нет данных')+'</td><td>'+s(m.longDate(c.registered))+'</td></tr>').join('')+
      '</tbody></table></div>':empty('Готовых к добавлению строк нет','Проверьте содержимое файла.','file'))+
      (result.issues.length?'<details class="import-issues" open><summary>Ошибки в строках</summary><ul>'+result.issues.slice(0,20).map(issue=>'<li>Строка '+issue.row+' · '+s(issue.reason)+'</li>').join('')+'</ul>'+
      (result.issues.length>20?'<p>Показано 20 из '+result.issues.length+' ошибок.</p>':'')+'</details>':'')+
      '<div class="table-footer"><span>'+(result.records.length>8?'Предпросмотр первых 8 строк. ':'')+'Дубли и строки с ошибками пропускаются.</span>'+
      button('Добавить клиентов','check','primary','commit-import',!result.records.length||ui.importBusy?'disabled':'')+'</div></section>';
  }
  const history=state.imports;
  return heading('Импорт данных','Добавьте вымышленных клиентов из Excel или CSV.',
    button('Скачать шаблон CSV','download','secondary','template'))+
    '<div class="import-grid"><section class="panel import-box"><div class="panel-head"><div><h2>Загрузка файла</h2><p>CSV, XLSX или XLS · до 15 МБ</p></div>'+iconBox('upload','berry')+'</div><div class="import-body">'+
    '<div class="dropzone" id="dropzone"><input id="import-file" type="file" class="sr-only" accept=".csv,.xlsx,.xls" tabindex="-1">'+iconBox(file?'file':'upload','berry')+
    '<strong>'+s(file?.name||'Перетащите файл сюда')+'</strong><p>'+s(ui.importBusy?'Обработка файла…':'или выберите файл на устройстве')+'</p>'+
    button(file?'Заменить файл':'Выбрать файл',null,'secondary','pick-file',ui.importBusy?'disabled':'')+'</div>'+
    '<label class="field"><span>Филиал для строк без филиала</span><span class="select-control"><select id="fallback" data-filter="fallback">'+branchOpts(ui.fallback,false)+'</select>'+icon('chevron',15)+'</span></label>'+
    (error?'<div role="alert" class="form-error">'+s(error)+'</div>':'')+'</div></section>'+
    '<section class="panel import-guide"><div class="panel-head"><div><h2>Подготовка файла</h2><p>Первая строка содержит заголовки</p></div>'+iconBox('info','stone')+'</div><div class="import-body">'+
    '<ul><li>Обязательный столбец — «ФИО».</li><li>Добавьте телефон, филиал, дату последнего визита, дату регистрации и услугу, если они известны.</li><li>Для дат используйте ДД.ММ.ГГГГ, ГГГГ-ММ-ДД или ячейки с датой Excel.</li><li>Дубли определяются по телефону или внешнему ID в пределах филиала.</li></ul>'+
    '<div class="hint">'+icon('info',18)+'<span>Если дата последнего визита пуста, клиент попадёт в сегмент «Нет данных».</span></div></div></section></div>'+preview+
    (history.length?'<section class="panel import-preview"><div class="panel-head"><div><h2>История импорта</h2><p>Последние загрузки</p></div></div><div class="table-wrap"><table><thead><tr><th>Файл</th><th>Дата</th><th>Добавлено</th></tr></thead><tbody>'+
    history.slice(0,10).map(x=>'<tr><td>'+s(x.name)+'</td><td>'+s(m.longDate(x.date))+'</td><td>'+m.number(x.added)+'</td></tr>').join('')+'</tbody></table></div></section>':'');
}

const views={home,clients:clientsPage,tasks:tasksPage,pipeline:pipelinePage,visits:visitsPage,branches:branchesPage,analytics:analyticsPage,import:importPage};
function render(preserveFocus=false){
  const focused=preserveFocus&&document.activeElement?.id;
  const caret=focused==='query'?document.activeElement.selectionStart:null;
  app.innerHTML=shell(views[ui.page]());
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
  present(modalHead('Демопрофиль','Выберите кабинет администратора или руководителя.')+'<div class="profile-list">'+m.people.map((p,index)=>
    '<button type="button" data-action="switch-profile" data-id="'+p.id+'" class="profile-option">'+avatar(p.name,index)+'<span><strong>'+s(p.name)+'</strong><small>'+s(p.role)+(p.branch?' · '+s(m.byBranch(p.branch).name):' · Вся сеть')+'</small></span>'+(p.id===ui.profile?icon('check',20):'')+'</button>'
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
  present(modalHead('Карточка клиента')+'<div class="drawer-body"><div class="client-profile">'+clientAvatar(c)+'<div><h3>'+s(c.name)+'</h3><p>'+s(m.byBranch(c.branch).label)+'</p></div>'+badge(m.clientSegment(state,c),m.segments)+'</div><div class="client-actions">'+
    button('Зафиксировать звонок','phone','primary','call','data-id="'+s(id)+'"')+
    button('Новая задача','plus','secondary','new-task','data-id="'+s(id)+'"')+
    (openDeal?button('Открыть воронку','funnel','secondary','edit-deal','data-id="'+s(openDeal.id)+'"'):
      button('Добавить в воронку','funnel','secondary','new-deal','data-id="'+s(id)+'"'))+'</div>'+
    '<dl class="client-facts"><div><dt>Телефон</dt><dd>'+s(m.formatPhone(c.phone))+'</dd></div><div><dt>Последний визит</dt><dd>'+s(last.lastVisit?m.longDate(last.lastVisit):'Нет данных')+'</dd></div><div><dt>Дата регистрации</dt><dd>'+s(m.longDate(c.registered))+'</dd></div><div><dt>Последняя услуга</dt><dd>'+s(last.lastVisit&&last.service?last.service:'—')+'</dd></div></dl>'+
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
    field('Плановая сумма, ₽',input('plannedInput',moneyInput(data.planned),'text','maxlength="16" inputmode="decimal" placeholder="Например, 2 450"'))+'</div></div>';
}
function taskModal(id='',clientId=''){
  const task=state.tasks.find(item=>item.id===id);
  const client=m.byClient(state,task?.clientId||clientId);
  const available=state.clients.filter(c=>!ui.branch||c.branch===ui.branch||c.id===client?.id)
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const preferred=mine()||m.people.find(p=>p.branch===(client?.branch||ui.branch))?.id||m.people[0].id;
  const d=task??{clientId,title:'',assignee:preferred,due:m.today(),status:'new',note:''};
  present(modalHead(task?'Задача':'Новая задача',task?s(client.name):'Назначьте следующий контакт с клиентом.')+
    '<form id="task-form"><div class="modal-body form-grid">'+
    field('Клиент',select('clientId',[['','Выберите клиента'],...available.map(c=>[c.id,c.name+' · '+m.byBranch(c.branch).name])],d.clientId,true),'wide')+
    field('Название задачи',input('title',d.title,'text','required maxlength="140" placeholder="Например, предложить повторный визит" autofocus'),'wide')+
    field('Ответственный',select('assignee',m.people.filter(p=>p.branch).map(p=>[p.id,p.name]),d.assignee,true))+
    field('Срок выполнения',input('due',d.due,'date','required'))+
    field('Статус',select('status',Object.entries(m.statuses).map(([key,value])=>[key,value.label]),d.status,true),'wide')+
    outcomeFields(d)+field('Комментарий','<textarea name="note" maxlength="1200" rows="3" placeholder="Детали для следующего контакта">'+s(d.note)+'</textarea>','wide')+
    '<div class="form-error wide" role="alert" hidden></div></div>'+modalFoot(task?'Сохранить задачу':'Создать задачу',task?'check':'plus')+'</form>','task',{id,clientId});
  toggleOutcome();
}
function quickContact(id,taskId='',assigned=''){
  const client=m.byClient(state,id);
  const task=state.tasks.find(item=>item.id===taskId);
  if(!client)return;
  const day=m.today();
  const assignee=assigned||task?.assignee||mine()||m.people.find(p=>p.branch===client.branch)?.id;
  const active=state.opportunities.find(item=>item.clientId===id&&isOpen(item));
  const options=[['','Выберите результат'],['booked','Записался'],['callback','Просит перезвонить'],
    ['no_answer','Не ответил'],['contacted','Есть интерес'],['declined','Отказался']];
  const fromClient=modal?.type==='client'&&dialog.open;
  present(modalHead('Результат контакта',client.name+' · '+m.formatPhone(client.phone))+
    '<form id="quick-contact-form"><div class="modal-body form-grid">'+
    (task?'<div class="contact-reference wide">'+icon('checkList',17)+'<span>'+s(task.title)+'</span></div>':'')+
    outcomeFields({planned:active?.planned,service:active?.service||m.lastKnownVisit(state,client).service},options)+
    '<div id="next-contact-date" class="field-group" hidden>'+
    field('Следующий контакт',input('followUp',m.shiftDate(day,1),'date','min="'+day+'" required'))+'</div>'+
    field('Ответственный',select('assignee',m.people.filter(p=>p.branch).map(p=>[p.id,p.name]),assignee,true),'wide')+
    field('Комментарий','<textarea name="note" maxlength="1200" rows="2" placeholder="Договорённости"></textarea>','wide')+
    '<div class="form-error wide" role="alert" hidden></div></div>'+modalFoot('Сохранить')+'</form>','contact',{id,taskId,fromClient});
  toggleOutcome();
}
function batchModal(){
  const branch=ui.branch||person().branch||m.branches[0].id;
  const assignee=m.people.find(p=>p.branch===branch)?.id;
  const day=m.today();
  present(modalHead('Назначить обзвон')+'<form id="batch-form"><div class="modal-body form-grid">'+
    field('Филиал',select('branch',m.branches.map(b=>[b.id,b.label]),branch,true))+
    field('Ответственный',select('assignee',m.people.filter(p=>p.branch).map(p=>[p.id,p.name]),assignee,true))+
    field('Клиенты',select('group',[['focus','Все, кто требует внимания'],['lost','Не были 90+ дней'],['attention','Не были 45–89 дней'],['unknown','Дата визита неизвестна']],'focus',true),'wide')+
    field('Максимум задач',select('count',[['10','10'],['25','25'],['50','50']],'10',true))+
    field('Срок',input('due',day,'date','required min="'+day+'"'))+
    '<output class="batch-summary wide" id="batch-count" role="status"></output><div class="form-error wide" role="alert" hidden></div>'+
    '</div>'+modalFoot('Назначить задачи','plus')+'</form>','batch');
  batchPreview();
}
function batchPreview(){
  const form=dialog.querySelector('#batch-form');
  const {branch,group,count}=form.elements;
  const size=Math.min(Number(count.value),m.availableForContact(state,branch.value,group.value).length);
  form.querySelector('#batch-count').textContent='Будет назначено задач: '+m.number(size);
  form.querySelector('[type="submit"]').disabled=!size;
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
  const assignee=deal?.assignee||mine()||m.people.find(p=>p.branch===(client?.branch||ui.branch))?.id||m.people[0].id;
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
    field('Ответственный',select('assignee',m.people.filter(p=>p.branch).map(p=>[p.id,p.name]),assignee,true))+
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

function toggleOutcome(){
  const form=dialog.querySelector('form');
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
  const next=dialog.querySelector('#next-contact-date');
  if(next){
    next.hidden=!result.value||booked||result.value==='declined';
    form.elements.followUp.disabled=next.hidden;
    form.elements.appointment.min=m.today();
  }
}

function updatePreview(){
  ui.importPreview=null;
  ui.importError='';
  if(!ui.importFile)return;
  try {ui.importPreview=previewRows(ui.importFile.rows,state.clients,ui.fallback,ui.importFile);}
  catch(err){ui.importError=err.message;}
}
async function handleFile(file){
  if(!file||ui.importBusy)return;
  ui.importBusy=true;ui.importError='';ui.importFile=null;ui.importPreview=null;
  render();
  try{
    const data=await readFile(file);
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
    const {added,duplicates}=await run({type:'import-clients',clients:ui.importPreview.records,filename:ui.importFile.name});
    ui.importFile=null;
    ui.importPreview=null;
    notify('Добавлено клиентов: '+m.number(added)+(duplicates?' · Уже в базе: '+m.number(duplicates):''));
  }catch(err){ui.importError='Сохранение не удалось. '+err.message;}
  finally{ui.importBusy=false;render();}
}
function downloadSample(){
  const url=URL.createObjectURL(new Blob([sampleCsv],{type:'text/csv;charset=utf-8'}));
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
    case 'switch-profile': ui.profile=id;ui.branch=id==='manager'?'':m.byPerson(id).branch;savePrefs();closeModal();go(id==='manager'?'analytics':'home');notify('Выбран профиль: '+person().name);break;
    case 'client': clientModal(id);break;
    case 'new-task': taskModal('',id);break;
    case 'edit-task': taskModal(id);break;
    case 'call': quickContact(id);break;
    case 'quick-contact': quickContact(id,element.dataset.task||'',element.dataset.assignee||'');break;
    case 'quick-search': quickSearch();break;
    case 'batch': batchModal();break;
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
  if(event.target.id==='quick-query')updateQuickSearch();
  if(event.target.dataset.filter==='query'){ui.query=event.target.value;ui.clientLimit=12;ui.taskLimit=15;ui.dealLimit=12;render(true);}
});
document.addEventListener('change',event=>{
  const field=event.target;
  if(field.id==='import-file'){void handleFile(field.files[0]);return;}
  if(dialog.contains(field)){
    if(field.form?.id==='batch-form'){
      if(field.name==='branch')field.form.elements.assignee.value=m.people.find(p=>p.branch===field.value).id;
      batchPreview();
    }
    if(field.name==='status'||field.name==='result')toggleOutcome();
    if(field.name==='stage')toggleDealFields();
    if(field.name==='clientId'&&modal.newBooking){
      const booking=state.opportunities.find(deal=>deal.clientId===field.value&&isOpen(deal));
      const client=m.byClient(state,field.value);
      const elements=field.form.elements;
      elements.service.value=booking?.service||client?.service||'';
      elements.plannedInput.value=moneyInput(booking?.planned);
      elements.assignee.value=booking?.assignee||mine()||m.people.find(p=>p.branch===client?.branch)?.id||m.people[0].id;
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
      const message=data.result==='booked'?'Клиент записан':data.result==='declined'?'Результат сохранён':
        'Следующий контакт: '+m.formatDate(data.followUp);
      notify(message);
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

applyTheme();
try {state=await repository.read();render();}
catch {app.innerHTML='<div class="boot" role="alert">Не удалось открыть хранилище. Проверьте разрешения браузера и перезагрузите страницу.</div>';}
