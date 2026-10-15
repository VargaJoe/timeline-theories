import { DomainError, FIELDS } from '../domain/content.mjs';
import { stableJson, hash } from './store.mjs';

export class MutationJournal {
  constructor(store,principal,repo){this.store=store;this.principal=principal;this.repo=repo;}
  async row(payload){return this.store.mutationRow(this.principal,payload.operationId);}
  // mutationRow prefers a terminal receipt, but its shared pending fence can
  // survive an interrupted cleanup. The plan must stay recoverable until that
  // fence is actually cleared, rather than saving a premature failed result.
  async isPending(payload){return (await this.store.pendingMutations()).some(row=>row.principal===this.principal&&row.operation_id===payload.operationId);}
  async assertRecoveryBoundary(operationIds){
    const pending=await this.store.pendingMutations();
    if(pending.some(row=>row.principal!==this.principal||!operationIds.includes(row.operation_id)))throw new DomainError('pending_recovery_required','A previous application write has an uncertain outcome. Its original caller must retry the saved plan/key before another application write.',409);
  }
  async receipt(payload) {
    const row=await this.row(payload);
    if(!row)return {found:false};
    if(row.request_hash!==payload.requestHash)throw new DomainError('idempotency_conflict','Operation ID is bound to another payload.',409);
    if(row.result){
      const saved=JSON.parse(row.result);
      // An interrupted terminal archive can leave its pending fence behind.
      // Replaying the same receipt finishes that CAS cleanup before returning.
      if(row.state==='partial')await this.fail(payload,saved);else await this.complete(payload,saved);
      return {found:true,requestHash:row.request_hash,...(row.state==='partial'?{ok:false,failure:saved}:{result:saved})};
    }
    const before=JSON.parse(row.before_state),saved=JSON.parse(row.payload);
    if(saved.action==='create') {
      let current;
      try{current=await this.repo.read(before.path);}catch(error){
        if(error.status===404)throw new DomainError('uncertain_create','The dispatched creation has no confirmed result yet. It will not be sent again; retry this saved plan/key to check for completion.',409,{uncertain:true});
        throw error;
      }
      if(current.Type!==saved.type||!this.matchesFields(current,saved.fields)||current.ParentId!==saved.parentId||current.Name!==saved.fields.Name)throw new DomainError('ambiguous_create','The reserved creation path exists with conflicting data. No duplicate was created.',409,{uncertain:true});
      // The application coordinator reserved a previously absent path before
      // dispatch. Only application writers share this recovery guarantee.
      const result={id:current.Id,revision:current.revision,replayed:true,reconciled:true};await this.complete(payload,result);return {found:true,requestHash:row.request_hash,result};
    }
    if(saved.action==='delete') {
      try{await this.repo.read(saved.targetId);}catch(error){if(error.status===404){const result={id:saved.targetId,revision:null,deleted:true,replayed:true,reconciled:true};await this.complete(payload,result);return {found:true,requestHash:row.request_hash,result};}throw error;}
      throw new DomainError('uncertain_delete','Deletion was dispatched but its completion is unconfirmed. It will not be sent again.',409,{uncertain:true});
    }
    if(saved.action==='order') {
      const members=await this.repo.children(saved.targetId,'order');
      if(members.length!==saved.entries.length||members.some(e=>!saved.entries.some(p=>p.id===e.Id)))throw new DomainError('membership_conflict','An uncertain order operation has changed membership.',409);
      const completed=members.filter(current=>saved.entries.some(e=>e.id===current.Id&&e.position===current.Position)).map(e=>({id:e.Id,revision:e.revision,replayed:true}));
      if(completed.length===members.length){const result={completed,atomic:false,reconciled:true};await this.complete(payload,result);return {found:true,requestHash:row.request_hash,result};}
      // A failed multi-save order is an explicit partial result. An ambiguous
      // resumed order never overwrites edits merely to make a retry look done.
      throw new DomainError('partial_order_conflict','The interrupted order has an uncertain outcome. Completed positions are reported; no member is overwritten during recovery.',409,{completed,uncertain:true});
    }
    const current=await this.repo.read(saved.targetId);
    if(current.revision===before.snapshot.revision)throw new DomainError('uncertain_update','The dispatched update has no confirmed result yet. It will not be sent again.',409,{uncertain:true});
    const expected={...before.snapshot,...saved.fields};
    const names=FIELDS[current.Type].filter(name=>name!=='CoverImageBin');
    if(names.some(name=>!this.equal(current[name],expected[name],name)))throw new DomainError('uncertain_operation_conflict','The uncertain operation differs from its approved postcondition. Review before retrying.',409,{uncertain:true});
    if(saved.bytesBase64){const bytes=await this.repo.coverBytes(current.Id);if(hash(bytes.toString('base64'))!==hash(saved.bytesBase64))throw new DomainError('uncertain_cover_conflict','Binary bytes differ from the approved cover; no new upload is dispatched.',409,{uncertain:true,completed:[{id:current.Id,revision:current.revision,fieldsApplied:true,coverApplied:false}]});}
    const result={id:current.Id,revision:current.revision,replayed:true,reconciled:true};await this.complete(payload,result);return {found:true,requestHash:row.request_hash,result};
  }
  equal(a,b,name){const value=v=>{if(Array.isArray(v)&&v.length<=1)v=v[0]??null;if(v===undefined||v==='')return null;if(['ReleaseDate','ChronologicalDate'].includes(name)&&typeof v==='string'&&Number.isFinite(Date.parse(v)))return new Date(v).toISOString();return v;};return stableJson(value(a))===stableJson(value(b));}
  matchesFields(current,fields){return Object.entries(fields).every(([name,value])=>this.equal(current[name],value,name));}
  async prepare(payload,before) { return this.store.prepareMutation(this.principal,payload,before); }
  async complete(payload,result){return this.store.completeMutation(this.principal,payload,result);}
  async fail(payload,result){return this.store.partialMutation(this.principal,payload,result);}
  async mutation(payload) {
    const previous=await this.receipt(payload);if(previous.found)return previous.ok===false?{...previous.failure,replayed:true}:{ok:true,result:previous.result,replayed:true};
    let before;
    if(payload.action==='create') {
      const parent=await this.repo.read(payload.parentId,{parent:true}),targetPath=parent.Path+'/'+payload.fields.Name;
      try{await this.repo.read(targetPath);throw new DomainError('duplicate_name','The requested Name already exists. Choose a new occurrence Name or operation.',409);}catch(error){if(error.status!==404)throw error;}
      before={path:targetPath,parent};
    } else if(payload.action==='order')before={members:await this.repo.children(payload.targetId,'order')};
    else before={snapshot:await this.repo.read(payload.targetId)};
    const prepared=await this.prepare(payload,before); // Shared pending CAS commits before external dispatch.
    if(!prepared.created) {
      // Another invocation already reserved dispatch. The native backend has
      // no operation receipts: recover postconditions and never send it again.
      const saved=await this.receipt(payload);
      return saved.ok===false?{...saved.failure,replayed:true}:{ok:true,result:saved.result,replayed:true};
    }
    try {
      const result=await this.repo.write(payload);
      if(result.ok)await this.complete(payload,result.result??result);
      else if(!result.uncertain)await this.fail(payload,result);
      return result;
    } catch(error) {
      if([400,401,403,404,409].includes(error.status)&&!error.details?.uncertain) {
        await this.fail(payload,{ok:false,code:error.code,message:error.message,status:error.status,completed:error.details?.completed??[]});
      }
      throw error;
    }
  }
}
