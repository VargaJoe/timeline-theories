import test from 'node:test';
import assert from 'node:assert/strict';
import { preview, apply, receiptTargets } from '../client/api/plans.mjs';
import { DomainError } from '../client/domain/content.mjs';

// Isolated actual planner/receipt logic. Real SenseNet acceptance remains in
// the sequential M0 scripts; no fake store result is claimed as backend proof.
function fixture() {
  const root='/Root/Content/PlanReview',paths={media:root+'/MediaLibrary',timelines:root+'/Timelines'};
  const rev='sha256:'+'1'.repeat(64),readCalls=[],asserted=[],state={rootAllowed:true,saved:0,writes:0};
  const rows=[{Id:2,ParentId:1,Type:'Folder',Name:'MediaLibrary',Path:paths.media,revision:rev},
    {Id:3,ParentId:2,Type:'Folder',Name:'nested',Path:paths.media+'/nested',revision:rev},
    ...[10,11].map(Id=>({Id,ParentId:2,Type:'MediaItem',Name:'old'+Id,Path:paths.media+'/old'+Id,DisplayName:'Before',Title:'Before',revision:rev}))];
  const repo={paths,read:async target=>{readCalls.push(target);const row=rows.find(r=>r.Id===target||r.Path===target);assert.ok(row,'Unexpected fixture read');if(row.Id===2&&!state.rootAllowed)throw new DomainError('permission_denied','Library root denied.',403);return {...row};},
    assert:async operations=>{asserted.push(...operations);if(!state.rootAllowed&&operations.some(op=>op.target===2))throw new DomainError('permission_denied','Library root denied.',403);},
    writableFields:async()=>{},assertWritableTarget:async()=>{},assertNameAvailable:async()=>{},assertLeaf:async()=>{},references:async()=>({hasReferences:false,readableReferences:[]})};
  let plan;const store={savePlan:async value=>{plan=value;state.saved++;},plan:async()=>plan,reserve:async()=>undefined};
  const context={repo,principal:'review-owner',scopes:['media:write','content:read'],check:async()=>{},journal:{assertRecoveryBoundary:async()=>{},receipt:async()=>({found:false}),mutation:async()=>{state.writes++;throw new Error('No mutation should be reached.');}}};
  const create=(Name='collision',parentId=2)=>({action:'create',type:'MediaItem',parentId,fields:{Name,DisplayName:'New',Title:'New',MediaType:'movie'}});
  const rename=(id=10,Name='collision')=>({action:'update',targetId:id,expectedRevision:rev,fields:{Name}});
  return{repo,context,store,state,readCalls,asserted,create,rename,rev,getPlan:()=>plan};
}

test('create and rename reserve the same destination before a whole plan can be saved, in either order',async()=>{
  for(const reverse of [false,true]){const f=fixture(),commands=[f.create(),f.rename()];if(reverse)commands.reverse();
    await assert.rejects(preview(f.context,{commands},f.store),e=>e.code==='intra_plan_conflict'&&e.status===409);
    assert.equal(f.state.saved,0);assert.equal(f.state.writes,0);
  }
});
test('two renames cannot reserve a case-insensitive duplicate destination',async()=>{
  const f=fixture();await assert.rejects(preview(f.context,{commands:[f.rename(10,'Shared'),f.rename(11,'shared')]},f.store),e=>e.code==='intra_plan_conflict');
  assert.equal(f.state.saved,0);assert.equal(f.state.writes,0);
});
test('the same Name in distinct parent folders remains a valid independent destination',async()=>{
  const f=fixture();const result=await preview(f.context,{commands:[f.create('same',2),f.create('same',3)]},f.store);
  assert.equal(result.counts.commands,2);assert.equal(f.state.saved,1);assert.equal(f.state.writes,0);
});
test('surviving update and order results check their exact content IDs without an unrelated root read',async()=>{
  const f=fixture();f.state.rootAllowed=false;
  const targets=await receiptTargets(f.context,{steps:[{payload:{action:'update',type:'MediaItem'}},{payload:{action:'order',type:'Timeline'}}]},
    {completed:[{index:0,result:{id:10}},{index:1,result:{completed:[{id:11}]}}]});
  assert.deepEqual(targets,[10,11]);assert.deepEqual(f.readCalls,[]);assert.deepEqual(f.asserted,[{target:10,action:'read'},{target:11,action:'read'}]);
});
test('confirmed deleted receipts use a surviving folder, and never require reading the deleted ID',async()=>{
  const f=fixture();const targets=await receiptTargets(f.context,{steps:[{payload:{action:'delete',type:'MediaItem',targetId:10,entries:[]}}]},
    {completed:[{index:0,result:{id:10,deleted:true}}]});
  assert.deepEqual(targets,[2]);assert.deepEqual(f.readCalls,[f.repo.paths.media]);
});
test('a missing deletion receipt fallback permission rejects preview with zero writes',async()=>{
  const f=fixture();f.state.rootAllowed=false;
  await assert.rejects(preview(f.context,{commands:[{action:'delete',targetId:10,expectedRevision:f.rev}]},f.store),e=>e.code==='permission_denied');
  assert.equal(f.state.saved,0);assert.equal(f.state.writes,0);
});
test('revoked deletion fallback is rechecked for the whole plan before an earlier allowed update dispatches',async()=>{
  const f=fixture();const plan=await preview(f.context,{commands:[{action:'update',targetId:11,expectedRevision:f.rev,fields:{Title:'Allowed first'}},{action:'delete',targetId:10,expectedRevision:f.rev}]},f.store);
  f.state.rootAllowed=false;
  await assert.rejects(apply(f.context,plan.id,'original-key',f.store),e=>e.code==='permission_denied');assert.equal(f.state.writes,0);
});
