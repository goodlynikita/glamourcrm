import {branches,phoneKey,today,shiftDate} from './model.mjs';

import {cleanImport,createImportIndex,importChanges} from './retention.mjs';

const aliases = {
  name:['фио','ф и о','имя','имя клиента','клиент','фамилия имя','полное имя','name','full name','fullname','client name','client'],
  phone:['телефон','номер телефона','мобильный телефон','мобильный','phone','telephone','mobile'],
  branch:['филиал','салон','branch','salon','location'],
  lastVisit:['последний визит','дата последнего визита','дата последнего посещения','последнее посещение','last visit','lastvisit','last visit date'],
  registered:['дата регистрации','дата создания','регистрация','created','created at','registration date','registered'],
  service:['услуга','последняя услуга','service','last service'],
  externalId:['id','id клиента','идентификатор','внешний id','external id','externalid','client id','код клиента'],
  visitCount:['число визитов','количество визитов','визитов','visit count','visits'],
  nextBooking:['следующая запись','дата следующей записи','будущая запись','next booking','next appointment'],
  lastCancellation:['последняя отмена','дата отмены','дата последней отмены','last cancellation'],
  cancelCount:['количество отмен','число отмен','отмен','cancellation count'],
  cancellations:['история отмен','даты отмен','cancellation history']
};
const normalize = text=>String(text??'').toLowerCase().trim().replace(/ё/g,'е').replace(/[._-]+/g,' ').replace(/\s+/g,' ');
const aliasesIndex=new Map(Object.entries(aliases).flatMap(([key,titles])=>titles.map(title=>[title,key])));
export const fieldLabels={
  name:'Имя клиента',phone:'Телефон',branch:'Филиал',externalId:'ID клиента',lastVisit:'Последний визит',
  registered:'Дата регистрации',service:'Последняя услуга',visitCount:'Количество визитов',
  nextBooking:'Следующая запись',lastCancellation:'Последняя отмена',cancelCount:'Количество отмен',cancellations:'История отмен'
};
const headers=['Имя клиента','Телефон','Филиал','ID клиента','Последний визит','Количество визитов','Следующая запись','Последняя отмена','Последняя услуга'];
export function demoCsv(directory=branches,day=today()){
  const at=index=>directory[index%directory.length].name;
  const rows=[
    ['Милана Снежина','+7 (000) 000-04-01',at(0),'demo-401',shiftDate(day,-95),1,'','','Маникюр'],
    ['Эльвира Ясенева','+7 (000) 000-04-02',at(1),'demo-402',shiftDate(day,-84),5,'','','Педикюр'],
    ['Таисия Ветрова','+7 (000) 000-04-03',at(2),'demo-403','',0,'',shiftDate(day,-6),''],
    ['Лидия Солнечная','+7 (000) 000-04-04',at(1),'demo-404',shiftDate(day,-103),4,shiftDate(day,5),'','Маникюр']
  ];
  const escape=value=>'"'+String(value).replaceAll('"','""')+'"';
  return '\uFEFF'+[headers,...rows].map(row=>row.map(escape).join(';')).join('\r\n')+'\r\n';
}
export const sampleCsv=demoCsv();

function parseDelimited(text,delimiter){
  const rows=[];
  let row=[], field='', quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}
      else if(quoted||!field.trim()) quoted=!quoted;
      else field+=char;
    }else if(!quoted && char===delimiter){
      row.push(field);
      field='';
    }else if(!quoted&&(char==='\n'||char==='\r')){
      row.push(field);
      rows.push(row);
      row=[];
      field='';
      if(char==='\r'&&text[i+1]==='\n') i++;
    }else field+=char;
  }
  if(quoted) throw new Error('В CSV есть незакрытые кавычки.');
  if(field||row.length){row.push(field);rows.push(row);}
  return rows;
}

export function parseCsv(input){
  const source=input.replace(/^\uFEFF/,'');
  const separator=/^sep=(.)\r?\n/i.exec(source);
  if(separator) return parseDelimited(source.slice(separator[0].length),separator[1]);
  const candidates=[';',',','\t'].map(delimiter=>{
    try {
      const rows=parseDelimited(source,delimiter);
      const header=rows.find(row=>row.some(cell=>cell.trim()))??[];
      return {rows,score:header.filter(cell=>aliasesIndex.has(normalize(cell))).length*100+header.length};
    }catch(error){return {error,score:-1};}
  }).sort((a,b)=>b.score-a.score);
  if(!candidates[0].rows) throw candidates[0].error;
  return candidates[0].rows;
}

let excelLoader;
function loadExcel(){
  if(globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  excelLoader ??= new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('./assets/xlsx.full.min.js',import.meta.url).href;
    script.onload=()=>globalThis.XLSX?resolve(globalThis.XLSX):reject(new Error('Модуль Excel не загрузился.'));
    script.onerror=()=>{script.remove();excelLoader=undefined;reject(new Error('Модуль Excel не загрузился. Повторите попытку.'));};
    document.head.append(script);
  });
  return excelLoader;
}
export async function readFile(file,excelApi){
  if(file.size>15*1024*1024) throw new Error('Выберите файл размером до 15 МБ.');
  if(!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error('Поддерживаются файлы CSV, XLSX и XLS.');
  const bytes=await file.arrayBuffer();
  if(/\.csv$/i.test(file.name)){
    let text;
    try {text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch {text=new TextDecoder('windows-1251').decode(bytes);}
    return {rows:parseCsv(text),sheet:''};
  }
  const xlsx=excelApi??await loadExcel();
  // Keep Excel calendar dates as serials to avoid shifting the day with local time zones.
  const workbook=xlsx.read(bytes,{type:'array',cellDates:false});
  for(const sheet of workbook.SheetNames){
    const rows=xlsx.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,defval:'',raw:true,blankrows:true});
    if(rows.some(row=>row.some(cell=>String(cell).trim()))) return {rows,sheet,date1904:workbook.Workbook?.WBProps?.date1904===true};
  }
  throw new Error('В книге Excel нет данных.');
}
function checkedDate(year,month,day){
  const val=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  const time=Date.parse(val+'T00:00:00Z');
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==val||year<1900) return null;
  return val;
}
export function parseDate(input,date1904=false){
  if(input===undefined||input===null||String(input).trim()==='') return '';
  if(input instanceof Date) return Number.isFinite(input.valueOf())?checkedDate(input.getUTCFullYear(),input.getUTCMonth()+1,input.getUTCDate()):null;
  const s=String(input).trim();
  const iso=/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}.*)?$/.exec(s);
  if(iso) return checkedDate(+iso[1],+iso[2],+iso[3]);
  const local=/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?: \d{1,2}:\d{2}.*)?$/.exec(s);
  if(local) return checkedDate(+local[3],+local[2],+local[1]);
  if(/^\d{4,6}(?:\.\d+)?$/.test(s)&&+s>=1000&&+s<=100000){
    const epoch=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30);
    return new Date(epoch+Math.floor(+s)*86400000).toISOString().slice(0,10);
  }
  return null;
}

export function detectColumns(rows){
  const headerIndex=rows.findIndex(row=>row.some(cell=>String(cell).trim()));
  if(headerIndex<0)throw Error('В файле нет данных.');
  const headers=rows[headerIndex].map(cell=>String(cell).trim());
  const mapping={};
  for(const [index,title] of headers.entries()){
    const key=aliasesIndex.get(normalize(title));
    if(key&&mapping[key]===undefined)mapping[key]=index;
  }
  return {headerIndex,headers,mapping};
}

export function previewRows(rows,existing,fallback,options={}){
  const layout=detectColumns(rows);
  const mapping=options.mapping??layout.mapping;
  if(!Number.isInteger(mapping.name))throw Error('Сопоставьте столбец с именем клиента.');
  const indexes=Object.values(mapping).filter(Number.isInteger);
  if(new Set(indexes).size!==indexes.length)throw Error('Один столбец нельзя выбрать для нескольких полей.');
  const directory=options.branches??branches;
  const records=[],examples=[],issues=[],index=createImportIndex(existing),seen=new Set();
  let duplicates=0,added=0,updated=0,hasRows=false;
  const day=today();
  for(let i=layout.headerIndex+1;i<rows.length;i++){
    const row=rows[i];
    if(!row.some(cell=>String(cell).trim()))continue;
    hasRows=true;
    const has=key=>Number.isInteger(mapping[key]);
    const value=key=>row[mapping[key]]??'';
    const str=key=>String(value(key)).trim();
    try{
      const branchInput=normalize(str('branch'));
      const matches=branchInput?directory.filter(item=>
        [item.id,item.name,item.label,...item.aliases].some(alias=>normalize(alias)===branchInput)):[];
      if(matches.length>1)throw Error('Неоднозначный филиал «'+str('branch')+'».');
      const branch=branchInput?matches[0]?.id:fallback;
      if(!branch)throw Error('Неизвестный филиал «'+str('branch')+'».');
      const item={name:str('name'),branch};
      if(!item.name)throw Error('Пустое имя клиента.');
      for(const key of ['phone','service','externalId'])if(has(key))item[key]=str(key);
      if(item.phone){
        const phone=phoneKey(item.phone);
        if(!phone)throw Error('Проверьте номер телефона.');
        item.phone=phone;
      }
      for(const key of ['lastVisit','registered','nextBooking','lastCancellation']){
        if(!has(key))continue;
        const date=parseDate(value(key),options.date1904);
        if(date===null||(key!=='nextBooking'&&date>day))throw Error('Проверьте дату в поле «'+fieldLabels[key]+'».');
        item[key]=date;
      }
      for(const key of ['visitCount','cancelCount']){
        if(!has(key))continue;
        const raw=str(key);
        if(raw&&!/^\d+$/.test(raw))throw Error('Проверьте поле «'+fieldLabels[key]+'».');
        item[key]=raw?Number(raw):null;
      }
      if(has('cancellations')){
        item.cancellations=str('cancellations').split(/[|;,\n]+/).map(piece=>piece.trim()).filter(Boolean)
          .map(piece=>parseDate(piece,options.date1904));
      }
      const record=cleanImport(item,directory,day,options);
      const match=index.find(record);
      if(match.error)throw Error(match.error);
      if(match.client){
        if(seen.has(match.client.id)){duplicates++;continue;}
        const changes=importChanges(match.client,record);
        if(!Object.keys(changes).length){duplicates++;continue;}
        seen.add(match.client.id);
        updated++;
        const after={...match.client,...changes};
        index.remove(match.client);
        index.add(after);
        examples.push({...after,operation:'Обновить'});
      }else{
        added++;
        const entry={...record,id:'preview:'+i};
        seen.add(entry.id);
        index.add(entry);
        examples.push({...entry,operation:'Добавить'});
      }
      records.push(record);
    }catch(error){issues.push({row:i+1,reason:error.message});}
  }
  if(!hasRows)throw Error('Добавьте хотя бы одну строку данных после заголовков.');
  return {records,examples,issues,duplicates,added,updated};
}
