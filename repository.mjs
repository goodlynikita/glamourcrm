import {applyCommand, seed, upgradeState} from './model.mjs';

export const storageKey='glamour-crm-v1';

export class BrowserRepository {
  constructor(storage=globalThis.localStorage){
    this.storage=storage;
  }
  async read(){
    const saved=this.storage.getItem(storageKey);
    return saved ? upgradeState(JSON.parse(saved)) : seed();
  }
  async dispatch(command){
    const update=async()=>{
      const state=await this.read();
      const {next,value}=applyCommand(state,command);
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
export const repository=new BrowserRepository();
