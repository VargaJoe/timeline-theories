import { randomUUID } from 'node:crypto';
import { DomainError, assertObject, assertId, TYPES, validateFields, fieldDiff, metadataDiff } from '../domain/content.mjs';
import { hash } from './store.mjs';

const scopes = { Timeline: 'timelines:write', MediaItem: 'media:write', BookMediaItem: 'media:write', TimelineEntry: 'entries:write' };
export function requireScope(context, scope) {
  if (!context.scopes.includes(scope)) throw new DomainError('scope_denied', `This credential does not have ${scope}.`, 403);
}
export function revision(content) {
  if (typeof content.revision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(content.revision)) throw new DomainError('backend_revision_unavailable', 'The coordinated application snapshot revision is unavailable.', 503);
  return content.revision;
}
const receiptFolder = (repo, type) => type === 'Timeline' || type === 'TimelineEntry' ? repo.paths.timelines : repo.paths.media;
// Stored receipts are private, but current Open rights still apply when a
// caller retrieves them later. Confirmed deleted IDs use their surviving
// application folder; they cannot be read as existing content again.
export async function receiptTargets(context, plan, result) {
  const deleted = new Set(), targets = new Set(), folders = new Set();
  for (const item of result.completed || []) {
    const step = plan.steps[item.index];
    if (step?.payload.action === 'delete' && item.result?.deleted) {
      deleted.add(step.payload.targetId);
      for (const entry of step.payload.entries || []) deleted.add(entry.id);
      folders.add(receiptFolder(context.repo, step.payload.type));
    }
    if (item.result?.id && !item.result.deleted) targets.add(item.result.id);
    for (const entry of item.result?.completed || []) if (entry.id && !entry.deleted) targets.add(entry.id);
  }
  for (const folder of folders) {
    targets.add((await context.repo.read(folder,{parent:true})).Id);
  }
  for (const id of deleted) targets.delete(id);
  await context.check(); await context.repo.assert([...targets].map(target=>({target,action:'read'}))); await context.check();
  return [...targets];
}
export async function preview(context, input, store) {
  assertObject(input);
  if (Object.keys(input).some(k => k !== 'commands')) throw new DomainError('invalid_input', 'Unknown plan input property.');
  const commands = input.commands;
  if (!Array.isArray(commands) || !commands.length || commands.length > 5000) throw new DomainError('invalid_commands', 'Supply 1..5000 application commands.');
  const repo = context.repo, steps = [], targets = [], diffs = [], effects = [], allOperations = [];
  const mutableIds = new Set(), reservedNames = new Set();
  const addStep = (payload, operations, preconditions, destination) => {
    if (destination) {
      const name=destination.toLowerCase();
      if (reservedNames.has(name)) throw new DomainError('intra_plan_conflict','Two commands reserve the same parent/Name.',409);
      reservedNames.add(name);
    }
    if (payload.action !== 'create') {
      const ids=payload.action==='order'?payload.entries.map(e=>e.id):[payload.targetId,...(payload.action==='delete'?payload.entries.map(e=>e.id):[])];
      if(ids.some(id=>mutableIds.has(id)))throw new DomainError('intra_plan_conflict','A plan may mutate each target once. Combine metadata and cover in one command.',409);
      ids.forEach(id=>mutableIds.add(id));
    }
    payload.requestHash = hash(payload);
    steps.push({ payload, operations, preconditions });
    allOperations.push(...operations);
  };
  for (const [index, command] of commands.entries()) {
    assertObject(command);
    if (!['create','update','delete','order','metadata','cover'].includes(command.action)) throw new DomainError('invalid_operation', 'Unsupported application command.');
    const keys = { create: ['action','type','parentId','fields'], update: ['action','targetId','expectedRevision','fields'], delete: ['action','targetId','expectedRevision'], order: ['action','timelineId','entries'], metadata: ['action','targetId','expectedRevision','proposal','overwrite','cover'], cover: ['action','targetId','expectedRevision','bytesBase64','mimeType','fileName'] }[command.action];
    if (Object.keys(command).some(k => !keys.includes(k))) throw new DomainError('invalid_input', 'Unknown command property.');
    const operationId = randomUUID();
    if (command.action === 'create') {
      if (!TYPES.includes(command.type)) throw new DomainError('invalid_type', 'Invalid application content type.');
      requireScope(context, scopes[command.type]); assertObject(command.fields);
      const parentTarget = command.parentId || (command.type === 'Timeline' ? repo.paths.timelines : command.type === 'TimelineEntry' ? assertId(command.parentId) : repo.paths.media);
      const parent = await repo.read(parentTarget, { parent: true });
      if (command.type === 'Timeline' && parent.Path !== repo.paths.timelines || command.type === 'TimelineEntry' && parent.Type !== 'Timeline' || ['MediaItem','BookMediaItem'].includes(command.type) && !(parent.Path === repo.paths.media || parent.Path.startsWith(repo.paths.media + '/'))) throw new DomainError('invalid_parent', 'Parent does not match the application content type.');
      const fields = validateFields(command.type, { ...command.fields, Name: command.fields.Name || 'm1-' + operationId }, { create: true });
      await repo.writableFields(command.type,fields,true);
      await repo.assertNameAvailable(parent.Path+'/'+fields.Name);
      const ops = [{ target: parent.Id, action: 'create', type: command.type }];
      if (command.type === 'TimelineEntry') { await repo.read(assertId(fields.MediaItem), { expectedType: 'MediaItem' }); ops.push({ target: fields.MediaItem, action: 'read' }); }
      addStep({ operationId, action: 'create', type: command.type, parentId: parent.Id, expectedRevision: revision(parent), fields }, ops, [{ id: parent.Id, revision: revision(parent), parent: true }], parent.Path+'/'+fields.Name);
      targets.push(parent.Id); diffs.push({ command: index, action: 'create', parentId: parent.Id, fields: fieldDiff({}, fields) }); continue;
    }
    if (command.action === 'order') {
      requireScope(context, 'entries:write');
      const timeline = await repo.read(assertId(command.timelineId), { expectedType: 'Timeline' });
      if (!Array.isArray(command.entries) || !command.entries.length || command.entries.length > 5000) throw new DomainError('invalid_order', 'Supply the complete ordered occurrence list.');
      const current = await repo.children(timeline.Id,'order');
      const ids = command.entries.map(e => { assertObject(e); if (Object.keys(e).some(k => !['id','revision'].includes(k))) throw new DomainError('invalid_order', 'Each order member contains id and revision.'); return assertId(e.id); });
      if (new Set(ids).size !== ids.length || ids.length !== current.length || current.some(e => !ids.includes(e.Id))) throw new DomainError('order_membership_conflict', 'Order must include every current occurrence exactly once.', 409);
      const ops = [], entries = [];
      for (const [position, member] of command.entries.entries()) {
        const before = current.find(e => e.Id === member.id);
        if (member.revision !== revision(before)) throw new DomainError('revision_conflict', 'An occurrence changed before preview.', 409);
        ops.push({ target: before.Id, action: 'update' }); targets.push(before.Id);
        entries.push({ id: before.Id, expectedRevision: revision(before), position: position + 1 });
        diffs.push({ command: index, targetId: before.Id, fields: fieldDiff(before, { Position: position + 1 }) });
      }
      addStep({ operationId, action: 'order', type: 'Timeline', targetId: timeline.Id, expectedRevision: revision(timeline), entries }, ops, current.map(e => ({ id: e.Id, revision: revision(e) })));
      continue;
    }
    const before = await repo.read(assertId(command.targetId));
    await repo.assertWritableTarget(before);
    requireScope(context, scopes[before.Type]);
    if (command.expectedRevision !== revision(before)) throw new DomainError('revision_conflict', 'Target changed; reload and preview again.', 409);
    const action = command.action === 'metadata' ? 'update' : command.action;
    const ops = [{ target: before.Id, action }], guards = [{ id: before.Id, revision: revision(before) }];
    const payload = { operationId, action, type: before.Type, targetId: before.Id, expectedRevision: revision(before) };
    let destination;
    targets.push(before.Id);
    if (action === 'delete') {
      const folder=await repo.read(receiptFolder(repo,before.Type),{parent:true});
      ops.push({target:folder.Id,action:'read'});
      if(before.Type!=='Timeline')await repo.assertLeaf(before.Id);
      const children = before.Type === 'Timeline' ? await repo.children(before.Id,'delete') : [];
      const references = ['MediaItem','BookMediaItem'].includes(before.Type) ? await repo.references(before.Id) : {hasReferences:false,readableReferences:[]};
      if (references.hasReferences) throw new DomainError('shared_reference_conflict', 'Media is still referenced. Delete the selected occurrences first.', 409, { references: references.readableReferences });
      for (const e of children) { ops.push({ target: e.Id, action: 'delete' }); guards.push({ id: e.Id, revision: revision(e) }); targets.push(e.Id); }
      payload.entries = children.map(e => ({ id: e.Id, expectedRevision: revision(e) }));
      effects.push({ command: index, deletes: [before.Id, ...children.map(e => e.Id)], sharedReferences: [] });
    } else if (action === 'cover') {
      if (!['MediaItem','BookMediaItem','Timeline'].includes(before.Type)) throw new DomainError('invalid_cover_target', 'This content does not support covers.');
      requireScope(context, 'covers:write');
      const bytes = decodeCover(command);
      Object.assign(payload, { bytesBase64: bytes.toString('base64'), mimeType: command.mimeType, fileName: command.fileName || 'cover' });
      diffs.push({ command: index, targetId: before.Id, fields: [{ field: 'CoverImageBin', before: 'existing binary', after: { byteLength: bytes.length, sha256: hash(bytes.toString('base64')) } }] });
    } else {
      let fields;
      if (command.action === 'metadata') {
        requireScope(context, 'metadata:write');
        const result = metadataDiff(before, command.proposal, { overwrite: command.overwrite === true }); fields = result.fields;
        effects.push({ command: index, sources: result.sources, preservedFields: result.protected });
      } else fields = validateFields(before.Type, command.fields);
      if(!Object.keys(fields).length&&command.cover===undefined)throw new DomainError('empty_change','The reviewed metadata proposal has no accepted changes.');
      if (fields.MediaItem) { await repo.read(assertId(fields.MediaItem), { expectedType: 'MediaItem' }); ops.push({ target: fields.MediaItem, action: 'read' }); }
      payload.fields = fields; diffs.push({ command: index, targetId: before.Id, fields: fieldDiff(before, fields) });
      if(Object.keys(fields).length)await repo.writableFields(before.Type,fields);
      if(fields.Name&&fields.Name!==before.Name){destination=before.Path.slice(0,before.Path.lastIndexOf('/'))+'/'+fields.Name;await repo.assertNameAvailable(destination,before.Id);}
      if (command.cover !== undefined) {
        assertObject(command.cover); requireScope(context,'covers:write');
        if (!['MediaItem','BookMediaItem'].includes(before.Type) || Object.keys(command.cover).some(k=>!['bytesBase64','mimeType','fileName'].includes(k))) throw new DomainError('invalid_cover','Metadata cover requires a valid media cover object.');
        const bytes=decodeCover(command.cover);
        Object.assign(payload,{bytesBase64:bytes.toString('base64'),mimeType:command.cover.mimeType,fileName:command.cover.fileName || 'cover'});
        diffs.at(-1).fields.push({field:'CoverImageBin',before:'existing binary',after:{byteLength:bytes.length,sha256:hash(bytes.toString('base64'))}});
      }
    }
    addStep(payload, ops, guards, destination);
  }
  await context.check(); await repo.assert(allOperations); await context.check();
  const plan = { id: randomUUID(), principal: context.principal, requestHash: hash(input), expires: Date.now() + 15 * 60 * 1000, steps, targets: [...new Set(targets)], diff: diffs, effects };
  await store.savePlan(plan);
  return publicPlan(plan);
}

export function decodeCover(input) {
  if (typeof input.bytesBase64 !== 'string' || input.bytesBase64.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.bytesBase64)) throw new DomainError('invalid_cover', 'Expected a bounded base64 cover.');
  const bytes = Buffer.from(input.bytesBase64, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(input.mimeType)) throw new DomainError('invalid_cover', 'Cover must be PNG, JPEG or WebP, at most 10 MiB.');
  const matches = input.mimeType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : input.mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!matches || input.fileName !== undefined && (typeof input.fileName!=='string'||!input.fileName.trim()||input.fileName.length>100||/[\\/"\r\n\x00]/.test(input.fileName))) throw new DomainError('invalid_cover', 'Cover signature or file name is invalid.');
  return bytes;
}
function publicPlan(plan) {
  return { id: plan.id, requestHash: plan.requestHash, expiresAt: new Date(plan.expires).toISOString(), targets: plan.targets, diff: plan.diff, effects: plan.effects, counts: { commands: plan.steps.length, targets: plan.targets.length, changedFields: plan.diff.reduce((n,d) => n + d.fields.length, 0) }, repositoryWrites: 0 };
}
export async function apply(context, id, key, store) {
  const plan = await store.plan(id, context.principal); await context.check();
  const previous = await store.reserve(context.principal, key, plan);
  if (previous) { await receiptTargets(context,plan,previous); return previous; }
  await context.journal.assertRecoveryBoundary(plan.steps.map(step=>step.payload.operationId));
  const receipts = new Map();
  for (const [index, step] of plan.steps.entries()) {
    await context.check();
    const receipt = await context.journal.receipt(step.payload);
    if (receipt?.found) {
      if (receipt.requestHash !== step.payload.requestHash) throw new DomainError('idempotency_conflict', 'The durable gateway receipt differs from this payload.', 409);
      receipts.set(index,receipt); continue;
    }
  }
  if (plan.expires <= Date.now() && receipts.size!==plan.steps.length) throw new DomainError('plan_expired', 'Plan expired. Confirmed receipts were reconciled; remaining changes require a fresh preview.', 409);
  for (const [index, step] of plan.steps.entries()) {
    if(receipts.has(index))continue;
    await context.repo.assert(step.operations);
    if(step.payload.action==='delete')await context.repo.read(receiptFolder(context.repo,step.payload.type),{parent:true});
    if(step.payload.targetId&&step.payload.action!=='order')await context.repo.assertWritableTarget(await context.repo.read(step.payload.targetId));
    if(step.payload.action==='create') {
      const parent=await context.repo.read(step.payload.parentId,{parent:true});
      await context.repo.writableFields(step.payload.type,step.payload.fields,true);
      await context.repo.assertNameAvailable(parent.Path+'/'+step.payload.fields.Name);
    } else if(step.payload.fields&&Object.keys(step.payload.fields).length) {
      await context.repo.writableFields(step.payload.type,step.payload.fields);
      if(step.payload.fields.Name){const target=await context.repo.read(step.payload.targetId);await context.repo.assertNameAvailable(target.Path.slice(0,target.Path.lastIndexOf('/'))+'/'+step.payload.fields.Name,target.Id);}
    }
    if(step.payload.action==='delete'&&step.payload.type!=='Timeline') {
      await context.repo.assertLeaf(step.payload.targetId);
      if(['MediaItem','BookMediaItem'].includes(step.payload.type)&&(await context.repo.references(step.payload.targetId)).hasReferences)throw new DomainError('shared_reference_conflict','Media gained a reference since preview; no writes applied.',409);
    }
    if(step.payload.action==='order'||step.payload.action==='delete'&&step.payload.type==='Timeline') {
      const members=await context.repo.children(step.payload.targetId,step.payload.action==='order'?'order':'delete');
      const planned=step.payload.entries.map(e=>e.id);
      if(members.length!==planned.length||members.some(e=>!planned.includes(e.Id)))throw new DomainError('membership_conflict','Timeline membership changed since preview; no writes applied.',409);
    }
    for (const guard of step.preconditions) {
      const current = await context.repo.read(guard.id, { parent: guard.parent });
      if (revision(current) !== guard.revision) throw new DomainError('revision_conflict', 'A target changed since preview; no writes applied.', 409, { targetId: guard.id });
    }
  }
  const pendingOps = plan.steps.flatMap((step,index) => receipts.has(index) ? [] : step.operations);
  await context.repo.assert(pendingOps); await context.check();
  const completed = [], notApplied = [];
  for (const [index, step] of plan.steps.entries()) {
    try {
      await context.check();
      if(!receipts.has(index))await context.repo.assert(step.operations);
      const saved=receipts.get(index);
      const result = saved ? {ok:saved.ok!==false,result:saved.result,...(saved.failure||{}),replayed:true} : await context.journal.mutation(step.payload);
      if (!result?.ok) {
        if (Array.isArray(result?.completed) && result.completed.length) completed.push({index,operationId:step.payload.operationId,result:{completed:result.completed},partial:true});
        throw new DomainError(result?.code || 'backend_apply_failed', result?.message || 'The standard repository mutation failed.', result?.status || (result?.code?.includes('conflict') ? 409 : 403), result);
      }
      completed.push({ index, operationId: step.payload.operationId, result: result.result ?? result, replayed: result.replayed === true });
      // A completed deletion must not be re-preflighted as a missing target.
      for (const op of step.operations) { const i = pendingOps.indexOf(op); if (i >= 0) pendingOps.splice(i,1); }
    } catch (error) {
      notApplied.push(...plan.steps.slice(index).map((s,offset) => ({ index: index + offset, operationId: s.payload.operationId, targetId: s.payload.targetId ?? s.payload.parentId })));
      const touchedIds=completed.flatMap(c=>c.result.id?[c.result.id]:Array.isArray(c.result.completed)?c.result.completed.map(e=>e.id):[]);
      const pendingTargets=plan.steps.slice(index).flatMap(s=>s.payload.action==='order'?s.payload.entries.map(e=>e.id):[s.payload.targetId??s.payload.parentId]);
      const uncertain=error.details?.uncertain===true || await context.journal.isPending(step.payload);
      const result = { ok: false, planId: id, completed, touchedIds, notApplied, notAppliedTargets:[...new Set(pendingTargets.filter(id=>!touchedIds.includes(id)))], error: { code: error.code || 'backend_failure', message: error instanceof DomainError?error.message:'Repository mutation failed.',status:error.status||502 }, conflicted: error.status === 409 ? [error.details?.failedId ?? step.payload.targetId ?? step.payload.parentId] : [], ...(uncertain?{retrySamePlan:true,uncertainTargets:[step.payload.targetId??step.payload.parentId]}:{}) };
      if(!uncertain)await store.finish(context.principal, key, result);
      await store.audit(context.principal, 'apply', uncertain?'uncertain':completed.length ? 'partial' : 'denied', plan.targets); return result;
    }
  }
  const result = { ok: true, planId: id, completed, touchedIds:completed.flatMap(c=>c.result.id?[c.result.id]:Array.isArray(c.result.completed)?c.result.completed.map(e=>e.id):[]), notApplied: [], notAppliedTargets:[], conflicted: [] };
  await store.finish(context.principal, key, result); await store.audit(context.principal, 'apply', 'completed', plan.targets); return result;
}
