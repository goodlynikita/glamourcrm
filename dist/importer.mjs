import {branches, phoneKey, today, importKeys, isDuplicate, addImportKeys} from './model.mjs';

const aliases = {
  name:['фио','ф и о','имя','имя клиента','клиент','фамилия имя','полное имя','name','full name','fullname','client name','client'],
  phone:['телефон','номер телефона','мобильный телефон','мобильный','phone','telephone','mobile'],
  branch:['филиал','салон','branch','salon','location'],
  lastVisit:['последний визит','дата последнего визита','дата последнего посещения','последнее посещение','last visit','lastvisit','last visit date'],
  registered:['дата регистрации','дата создания','регистрация','created','created at','registration date','registered'],
  service:['услуга','последняя услуга','service','last service'],
  externalId:['id','id клиента','идентификатор','внешний id','external id','externalid','client id']
};
const normalize = text=>String(text??'').toLowerCase().trim().replace(/ё/g,'е').replace(/[._-]+/g,' ').replace(/\s+/g,' ');
const aliasesIndex=new Map(Object.entries(aliases).flatMap(([key,titles])=>titles.map(title=>[title,key])));
export const sampleCsv='\uFEFFФИО;Телефон;Филиал;Дата последнего визита;Дата регистрации;Услуга\r\nМилана Снежина;+7 (000) 000-04-01;Центр;2026-07-15;2025-10-20;Маникюр\r\nЭльвира Ясенева;+7 (000) 000-04-02;Север;;2025-10-21;\r\n';

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

export function previewRows(rows,existing,fallback,options={}){
  const headerIndex=rows.findIndex(row=>row.some(cell=>String(cell).trim()));
  if(headerIndex<0) throw new Error('В файле нет данных.');
  const fields={};
  rows[headerIndex].forEach((cell,index)=>{
    const key=aliasesIndex.get(normalize(cell));
    if(key && fields[key]===undefined) fields[key]=index;
  });
  if(fields.name===undefined) throw new Error('В первой строке таблицы нужен столбец «ФИО».');
  const records=[],issues=[];
  let duplicates=0,hasRows=false;
  const keys=importKeys(existing);
  const day=today();
  for(let i=headerIndex+1;i<rows.length;i++){
    const row=rows[i];
    if(!row.some(cell=>String(cell).trim())) continue;
    hasRows=true;
    const value=key=>row[fields[key]]??'';
    const str=key=>String(value(key)).trim();
    const branchInput=normalize(str('branch'));
    const branch=branchInput?branches.find(item=>[item.id,item.name,item.label,...item.aliases].some(alias=>normalize(alias)===branchInput))?.id:fallback;
    const phoneInput=str('phone');
    const phone=phoneKey(phoneInput);
    const name=str('name');
    const lastVisit=parseDate(value('lastVisit'),options.date1904);
    const registered=parseDate(value('registered'),options.date1904);
    let reason='';
    if(!name) reason='Пустое ФИО';
    else if(!branches.some(item=>item.id===branch)) reason='Неизвестный филиал «'+str('branch')+'»';
    else if(phoneInput&&!phone) reason='Проверьте номер телефона';
    else if(lastVisit===null||lastVisit>day) reason='Проверьте дату последнего визита';
    else if(registered===null||registered>day) reason='Проверьте дату регистрации';
    if(reason){issues.push({row:i+1,reason});continue;}
    const record={name,phone,branch,lastVisit,registered,service:str('service'),externalId:str('externalId')};
    if(isDuplicate(keys,record)){duplicates++;continue;}
    addImportKeys(keys,record);
    records.push(record);
  }
  if(!hasRows) throw new Error('Добавьте хотя бы одну строку данных после заголовков.');
  return {records,issues,duplicates};
}
