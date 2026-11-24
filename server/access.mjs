import {assignedBranches,byClient,byPerson,settingsFor} from '../dist/model.mjs';

export class RequestError extends Error{
  constructor(status,message){super(message);this.status=status;}
}
const denied=()=>{throw new RequestError(403,'Доступ к этому действию или филиалу закрыт.');};
export function visibleState(state,person){
  if(!person)denied();
  if(!person.branch)return state;
  const allowed=new Set(assignedBranches(person));
  const clients=state.clients.filter(client=>allowed.has(client.branch));
  const ids=new Set(clients.map(client=>client.id));
  const settings=settingsFor(state);
  return {...state,clients,
    tasks:state.tasks.filter(task=>ids.has(task.clientId)),
    recoveries:(state.recoveries??[]).filter(entry=>ids.has(entry.clientId)),
    opportunities:state.opportunities.filter(deal=>ids.has(deal.clientId)),imports:[],
    agent:{...state.agent,lastRun:null,feedback:state.agent.feedback.filter(item=>allowed.has(item.branch))},
    settings:{rules:settings.rules,branches:settings.branches.filter(branch=>allowed.has(branch.id)),
      users:settings.users.filter(user=>assignedBranches(user).some(id=>allowed.has(id)))}
  };
}

export function commandFor(state,input,identity,{demo=false}={}){
  const person=byPerson(identity,state);
  if(!person||!input||typeof input!=='object'||Array.isArray(input))denied();
  const {type}=input;
  const manager=!person.branch;
  const allowed=new Set(assignedBranches(person));
  const clientAccess=(id)=>{
    const client=byClient(state,id);
    if(!client||(!manager&&!allowed.has(client.branch)))denied();
    return client;
  };
  const checkAssignee=id=>{if(!manager&&id!==identity)denied();};
  const checkExisting=(list,id,clientId)=>{
    if(!id)return;
    const record=list.find(item=>item.id===id);
    if(!record||record.clientId!==clientId)denied();
    clientAccess(record.clientId);
    if(!manager&&record.assignee!==identity)denied();
  };
  switch(type){
    case 'import-clients':
    case 'assign-outreach':
    case 'save-settings':
    case 'agent-cycle':
    case 'agent-settings':
      if(!manager)denied();
      return {...input,actor:identity,demoOnly:demo};
    case 'reset-demo':
      if(!manager||!demo)denied();
      return {type,actor:identity};
    case 'agent-feedback':
      clientAccess(input.clientId);
      return {type,clientId:input.clientId,objection:input.objection,option:input.option,helpful:input.helpful,actor:identity};
    case 'save-task': {
      const task=input.task;
      if(!task||typeof task!=='object')denied();
      clientAccess(task.clientId);
      checkExisting(state.tasks,task.id,task.clientId);
      checkAssignee(task.assignee);
      if(!manager&&!task.id&&task.reason&&task.reason!=='manual'&&task.reason!=='followup')denied();
      return {type,task,actor:identity};
    }
    case 'record-contact': {
      const {clientId,taskId,values}=input;
      if(!values||typeof values!=='object')denied();
      clientAccess(clientId);
      checkExisting(state.tasks,taskId,clientId);
      checkAssignee(values.assignee);
      return {type,clientId,taskId,values,actor:identity};
    }
    case 'save-deal': {
      const {values}=input;
      if(!values||typeof values!=='object')denied();
      clientAccess(values.clientId);
      checkExisting(state.opportunities,values.id,values.clientId);
      checkAssignee(values.assignee);
      return {type,values,mergeBooking:input.mergeBooking===true,actor:identity};
    }
    default: denied();
  }
}
