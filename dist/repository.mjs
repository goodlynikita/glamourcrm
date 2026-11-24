import {applyCommand, seed, upgradeState} from './model.mjs';

export const storageKey='glamour-crm-v1';

export class BrowserRepository {
  constructor(storage=globalThis.localStorage){
    this.storage=storage;
  }
  async read(){
    const saved=this.storage.getItem(storageKey);
    const previous=saved?JSON.parse(saved):null;
    const snapshot=previous?upgradeState(previous):seed();
    if(!previous?.agent)snapshot.agent.auto=true;
    return snapshot;
  }
  async dispatch(command){
    const update=async()=>{
      const state=await this.read();
      const {next,value}=applyCommand(state,{...command,demoOnly:true});
      if(command.type==='reset-demo')next.agent.auto=true;
      this.storage.setItem(storageKey,JSON.stringify(next));
      return {state:next,value};
    };
    return globalThis.navigator?.locks
      ? navigator.locks.request(storageKey,update)
      : update();
  }
}

// The interface is read() and dispatch(command). An HTTP adapter can use the
// same normalized model while translating Malakhit IDs and fields at its edge.
export const runtime=documentOrNull()?.querySelector('meta[name="glamour-runtime"]')?.content||'browser';
function documentOrNull(){return globalThis.document??null;}
export const serverMode=runtime!=='browser';
export const demoMode=runtime!=='server';
async function api(path,values){
  const request=values===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)};
  const response=await fetch(new URL('api/'+path,location.href),request);
  const data=await response.json();
  if(!response.ok){
    const error=new Error(data.error||'Запрос не выполнен.');
    error.status=response.status;
    throw error;
  }
  return data;
}
export const repository=serverMode?{
  read:()=>api('state'),dispatch:command=>api('commands',command),session:()=>api('session'),
  login:values=>api('login',values),logout:()=>api('logout',{})
}:new BrowserRepository();
