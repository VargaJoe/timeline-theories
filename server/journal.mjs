import { DomainError, FIELDS } from '../client/domain/content.mjs';
import { stableJson, hash } from './store.mjs';

export class MutationJournal {
  constructor(store,principal,repo){this.store=store;this.principal=principal;this.repo=repo;}
  row(payload){return this.store.db.prepare('SELECT * FROM mutations WHERE principal=? AND operation_id=?').get(this.principal,payload.operationId);}
  isPending(payload){return this.row(payload)?.state==='pending';}
  assertRecoveryBoundary(operationIds){
    const pending=this.store.db.prepare("SELECT principal,operation_id FROM mutations WHERE state='pending'").all();
    if(pending.some(row=>row.principal!==this.principal||!operationIds.includes(row.operation_id)))throw new DomainError('pending_recovery_required','A previous application write has an uncertain outcome. Its original caller must retry the saved plan/key before another application write.',409);
  }
  async receipt(payload) {
    const row=this.row(payload);
    if(!row)return {found:false};
    if(row.request_hash!==payload.requestHash)throw new DomainError('idempotency_conflict','Operation ID is bound to another payload.',409);
    if(row.result){const saved=JSON.parse(row.result);return {found:true,requestHash:row.request_hash,...(row.state==='partial'?{ok:false,failure:saved}:{result:saved})};}
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
      const result={id:current.Id,revision:current.revision,replayed:true,reconciled:true};this.complete(payload,result);return {found:true,requestHash:row.request_hash,result};
    }
    if(saved.action==='delete') {
      try{await this.repo.read(saved.targetId);}catch(error){if(error.status===404){const result={id:saved.targetId,revision:null,deleted:true,replayed:true,reconciled:true};this.complete(payload,result);return {found:true,requestHash:row.request_hash,result};}throw error;}
      throw new DomainError('uncertain_delete','Deletion was dispatched but its completion is unconfirmed. It will not be sent again.',409,{uncertain:true});
    }
    if(saved.action==='order') {
      const members=await this.repo.children(saved.targetId,'order');
      if(members.length!==saved.entries.length||members.some(e=>!saved.entries.some(p=>p.id===e.Id)))throw new DomainError('membership_conflict','An uncertain order operation has changed membership.',409);
      const completed=members.filter(current=>saved.entries.some(e=>e.id===current.Id&&e.position===current.Position)).map(e=>({id:e.Id,revision:e.revision,replayed:true}));
      if(completed.length===members.length){const result={completed,atomic:false,reconciled:true};this.complete(payload,result);return {found:true,requestHash:row.request_hash,result};}
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
    const result={id:current.Id,revision:current.revision,replayed:true,reconciled:true};this.complete(payload,result);return {found:true,requestHash:row.request_hash,result};
  }
  equal(a,b,name){const value=v=>{if(Array.isArray(v)&&v.length<=1)v=v[0]??null;if(v===undefined||v==='')return null;if(['ReleaseDate','ChronologicalDate'].includes(name)&&typeof v==='string'&&Number.isFinite(Date.parse(v)))return new Date(v).toISOString();return v;};return stableJson(value(a))===stableJson(value(b));}
  matchesFields(current,fields){return Object.entries(fields).every(([name,value])=>this.equal(current[name],value,name));}
  prepare(payload,before) {
    this.store.db.prepare('INSERT OR IGNORE INTO mutations VALUES (?,?,?,?,?,?,NULL,?)').run(this.principal,payload.operationId,payload.requestHash,JSON.stringify(payload),JSON.stringify(before),'pending',Date.now());
    const row=this.row(payload);if(row.request_hash!==payload.requestHash)throw new DomainError('idempotency_conflict','Operation ID already exists with different content.',409);
  }
  complete(payload,result){this.store.db.prepare('UPDATE mutations SET state=?,result=? WHERE principal=? AND operation_id=? AND request_hash=?').run('completed',JSON.stringify(result),this.principal,payload.operationId,payload.requestHash);}
  fail(payload,result){this.store.db.prepare('UPDATE mutations SET state=?,result=? WHERE principal=? AND operation_id=? AND request_hash=?').run('partial',JSON.stringify(result),this.principal,payload.operationId,payload.requestHash);}
  async mutation(payload) {
    const previous=await this.receipt(payload);if(previous.found)return previous.ok===false?{...previous.failure,replayed:true}:{ok:true,result:previous.result,replayed:true};
    let before;
    if(payload.action==='create') {
      const parent=await this.repo.read(payload.parentId,{parent:true}),targetPath=parent.Path+'/'+payload.fields.Name;
      try{await this.repo.read(targetPath);throw new DomainError('duplicate_name','The requested Name already exists. Choose a new occurrence Name or operation.',409);}catch(error){if(error.status!==404)throw error;}
      before={path:targetPath,parent};
    } else if(payload.action==='order')before={members:await this.repo.children(payload.targetId,'order')};
    else before={snapshot:await this.repo.read(payload.targetId)};
    this.prepare(payload,before); // Main DB commits before the external dispatch.
    try {
      const result=await this.repo.write(payload);
      if(result.ok)this.complete(payload,result.result??result);
      else if(!result.uncertain)this.fail(payload,result);
      return result;
    } catch(error) {
      if([400,401,403,404,409].includes(error.status)&&!error.details?.uncertain) {
        this.fail(payload,{ok:false,code:error.code,message:error.message,status:error.status,completed:error.details?.completed??[]});
      }
      throw error;
    }
  }
}
