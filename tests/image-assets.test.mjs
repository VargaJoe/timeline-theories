import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ImageAssets, decodeImageVariant, validateImageManifest, validateImageVariant, validateImageBytes } from '../client/api/image-assets.mjs';
import { StockRepository } from '../client/api/stock-repository.mjs';
import raster from '../scripts/helpers/image-variant-fixture.cjs';
import { storedCoverMime } from '../client/api/covers.mjs';
import { imageProtocolFixture } from './helpers/image-assets-protocol-fixture.mjs';

const manifest = () => ({ schemaVersion: 1, kind: 'timeline-composite', projectPath: '/Root/Content/Images', ownerId: 20, generationId: randomUUID(), sourceIds: [10, 11], sourceStamps: [{ id: 10, stamp: 'a'.repeat(64) }, { id: 11, stamp: 'b'.repeat(64) }], recipe: { template: 'poster-strip-v1', sourceIds: [10, 11], seed: 42 }, variants: [] });
const imageOwner = () => ({ Id: 20, ParentId: 2, Type: 'Timeline', Name: 'owner', Path: '/Root/Content/Images/Timelines/owner', ModificationDate: '2026-11-06T00:00:00Z', Version: 'V1.0' });
const imageRoot = (owner, { legacy = false, id = 30 } = {}) => ({ Id: id, ParentId: owner.Id, Type: legacy ? 'Folder' : 'SystemFolder', IsSystemContent: !legacy, Name: legacy ? '_images' : '(images)', Path: owner.Path + (legacy ? '/_images' : '/(images)'), Description: JSON.stringify({ protocol: 'timeline-image-assets-v1', projectPath: '/Root/Content/Images', ownerId: owner.Id, activeSetId: null, generationId: null, selectionRevision: randomUUID() }) });

// Exercise the stock endpoint/projection/collection code against the protocol
// fixture, without claiming this controlled response model proves SenseNet.
function imageRepositoryFixture(owner, rows = []) {
  const contents = new Map([owner, ...rows].map(row => [row.Id, row])), requests = [], host = { deniedIds: new Set(), allowSave: true };
  const fixture = imageProtocolFixture('/Root/Content/Images', contents, (res, status, value) => { res.response = { status, value: structuredClone(value) }; }, host);
  fixture.state.enabled = true;
  const repo = new StockRepository({ projectRoot: '/Root/Content/Images', repositoryUrl: 'https://fixture.invalid' }, { mode: 'Bearer', value: 'fixture' });
  repo.request = async (target, options = {}) => {
    const url = new URL(target), method = options.method || 'GET', body = options.body;
    requests.push({ method, path: decodeURIComponent(url.pathname), query: Object.fromEntries(url.searchParams), ...(body ? { body: structuredClone(body) } : {}) });
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]); req.method = method; req.headers = { authorization: 'Bearer fixture' };
    const res = {};
    if (!await fixture.handle(req, res, url)) {
      const row = contents.get(Number(url.pathname.match(/content\((\d+)\)/)?.[1]));
      if (row && url.pathname.endsWith('/HasPermission')) res.response = { status: 200, value: !host.deniedIds.has(row.Id) && (url.searchParams.get('permissions') !== 'Save' || host.allowSave) };
      else res.response = { status: row ? 200 : 404, value: structuredClone(row || null) };
    }
    const response = res.response;
    if (response.status >= 400) { const error = new Error('Fixture repository rejected the request.'); error.status = response.status; throw error; }
    if (['POST', 'PATCH', 'DELETE'].includes(method)) options.onDispatch?.();
    return response;
  };
  return { repo, contents, requests, host, state: fixture.state };
}

test('new storage creates a SystemFolder with its own child settings and retains owner content', async () => {
  const owner = { ...imageOwner(), Title: 'Preserve owner', AllowedChildTypes: { results: [{ Name: 'TimelineEntry' }] } }, before = structuredClone(owner);
  const { repo, contents, requests } = imageRepositoryFixture(owner);
  const snapshot = await repo.read(owner.Id, { image: false }), root = await repo.images.ensureStorage(snapshot);
  assert.equal(root.Name, '(images)'); assert.equal(root.Path, owner.Path + '/(images)'); assert.equal(root.Type, 'SystemFolder'); assert.equal(root.IsSystemContent, true);
  const stored = contents.get(root.Id); assert.deepEqual(stored.AllowedChildTypes.results.map(type => type.Name), ['Folder', 'File']);
  assert.deepEqual(owner.AllowedChildTypes.results.map(type => type.Name).filter(name => ['TimelineEntry', 'Folder', 'File'].includes(name)).sort(), ['File', 'Folder', 'TimelineEntry']);
  for (const key of ['Title', 'Name', 'Path', 'Type']) assert.equal(owner[key], before[key]);
  assert.equal(JSON.parse(root.Description).ownerId, owner.Id); assert.equal(JSON.parse(root.Description).activeSetId, null);
  const creates = requests.filter(request => request.method === 'POST'); assert.equal(creates.length, 1); assert.equal(creates[0].body.__ContentType, 'SystemFolder');
  assert(requests.some(request => request.path.endsWith('/EffectiveAllowedChildTypes') && request.path.includes('content(20)')));
  assert(requests.filter(request => request.path.endsWith("('(images)')")).every(request => request.query.$select.split(',').includes('IsSystemContent')));
  const writes = requests.filter(request => ['POST', 'PATCH'].includes(request.method)).length;
  await repo.images.ensureStorage(await repo.read(owner.Id, { image: false }));
  assert.equal(requests.filter(request => ['POST', 'PATCH'].includes(request.method)).length, writes, 'reopening existing storage never changes child settings or creates another root');
});

test('SystemFolder root and its generated Folder/File subtree obey default and OFF autofilters', async () => {
  const owner = { ...imageOwner(), AllowedChildTypes: { results: [{ Name: 'Folder' }, { Name: 'File' }] } }, root = imageRoot(owner);
  root.AllowedChildTypes = { results: [{ Name: 'Folder' }, { Name: 'File' }] };
  const entry = { Id: 21, ParentId: owner.Id, Type: 'TimelineEntry', Name: 'entry', Path: owner.Path + '/entry' };
  const { repo, contents, requests } = imageRepositoryFixture(owner, [root, entry]);
  const generation = await repo.api(root.Id, null, { method: 'POST', body: { __ContentType: 'Folder', Name: randomUUID(), Description: '{}' } });
  const file = await repo.api(generation.Id, null, { method: 'POST', body: { __ContentType: 'File', Name: 'w400.png' } });
  assert.equal(generation.Type, 'Folder'); assert.equal(file.Type, 'File'); assert.equal(contents.get(generation.Id).IsSystemContent, true); assert.equal(contents.get(file.Id).IsSystemContent, true);
  const query = '+InTree:' + owner.Path;
  const normal = await repo.collection(owner.Path, { query, '$top': 20 });
  assert.deepEqual(normal.results.map(row => row.Id).sort((a, b) => a - b), [20, 21]);
  const all = await repo.collection(owner.Path, { query: query + ' .AUTOFILTERS:OFF', '$top': 20 });
  assert.deepEqual(all.results.filter(row => row.IsSystemContent).map(row => row.Id).sort((a, b) => a - b), [root.Id, generation.Id, file.Id].sort((a, b) => a - b));
  const rows = await repo.images.entries(root.Path, 20, root.Id); assert.deepEqual(rows.map(row => row.Id), [generation.Id]);
  assert.match(requests.at(-1).query.query, /\.AUTOFILTERS:OFF\b/);
});

test('root creation requires SystemFolder permission even when ordinary Folder and File are allowed', async () => {
  const owner = { ...imageOwner(), AllowedChildTypes: { results: [{ Name: 'Folder' }, { Name: 'File' }] } };
  const { repo, requests } = imageRepositoryFixture(owner), api = repo.api.bind(repo);
  repo.api = async (target, operation, options) => {
    const value = await api(target, operation, options);
    return operation === 'EffectiveAllowedChildTypes' ? { results: value.results.filter(type => type.Name !== 'SystemFolder') } : value;
  };
  await assert.rejects(repo.images.ensureStorage(await repo.read(owner.Id, { image: false })), error => error.code === 'child_type_denied');
  assert.equal(requests.filter(request => ['POST', 'PATCH'].includes(request.method)).length, 0, 'allowed Folder/File types cannot authorize a SystemFolder root');
});

test('canonical storage takes precedence; only its 404 permits read-only legacy fallback', async () => {
  const owner = { ...imageOwner(), ImageStorageEnabled: true }, legacy = imageRoot(owner, { legacy: true, id: 40 }), canonical = imageRoot(owner);
  const { repo, contents, requests, host } = imageRepositoryFixture(owner, [legacy]);
  assert.equal((await repo.images.storage(owner)).Id, legacy.Id);
  assert.deepEqual(requests.map(request => request.path), ['/OData.svc' + owner.Path + "('(images)')", '/OData.svc' + owner.Path + "('_images')"]);
  assert(requests.every(request => request.method === 'GET'), 'legacy lookup never renames or migrates existing storage');
  contents.set(canonical.Id, canonical); requests.length = 0; repo.images.invalidate(owner.Id);
  assert.equal((await repo.images.storage(owner)).Id, canonical.Id); assert.equal(requests.length, 1);
  host.deniedIds.add(canonical.Id); requests.length = 0; repo.images.invalidate(owner.Id);
  await assert.rejects(repo.images.storage(owner), error => error.status === 403); assert.equal(requests.length, 1, 'denied canonical root cannot fall back to an accessible legacy root');
  host.deniedIds.clear(); canonical.Description = 'foreign content'; requests.length = 0; repo.images.invalidate(owner.Id);
  await assert.rejects(repo.images.storage(owner), error => error.code === 'image_storage_collision'); assert.equal(requests.length, 1, 'foreign canonical content cannot be masked by a legacy root');
  canonical.Description = legacy.Description; canonical.Type = 'Folder'; repo.images.invalidate(owner.Id);
  await assert.rejects(repo.images.storage(owner), error => error.code === 'image_storage_collision');
  canonical.Type = 'SystemFolder'; canonical.IsSystemContent = false; repo.images.invalidate(owner.Id);
  await assert.rejects(repo.images.storage(owner), error => error.code === 'image_storage_collision');
});
test('stored generic MIME uses only supported signatures and never relabels a known mismatch', () => {
  const samples = [['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], ['image/jpeg', Buffer.from([255, 216, 255, 224])], ['image/webp', Buffer.from('RIFFxxxxWEBP')]];
  for (const [mime, bytes] of samples) {
    assert.equal(storedCoverMime(bytes, 'application/octet-stream'), mime);
    assert.equal(storedCoverMime(bytes, mime), mime);
    assert.equal(storedCoverMime(bytes, mime === 'image/png' ? 'image/jpeg' : 'image/png'), null);
    assert.equal(storedCoverMime(bytes, 'text/html'), null);
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from('<svg/>'), Buffer.from('<html>'), Buffer.from('%PDF-1.7')]) assert.equal(storedCoverMime(bytes, 'application/octet-stream'), null);
});
test('manifest binds exact ordered sources, original SHA hashes and numeric deterministic recipe', () => {
  const valid = manifest(); assert.deepEqual(validateImageManifest(valid, { draft: true }), valid);
  for (const change of [value => value.recipe.sourceIds.reverse(), value => value.sourceStamps.reverse(), value => value.recipe.seed = randomUUID(), value => value.sourceIds.push(10), value => value.recipe.template = 'media-sizes-v1']) {
    const value = manifest(); change(value); assert.throws(() => validateImageManifest(value, { draft: true }), error => error.code === 'invalid_image_asset');
  }
});

test('media size manifests bind exactly the owner original rather than other media sources', () => {
  const self = { ...manifest(), kind: 'media-sizes', sourceIds: [20], sourceStamps: [{ id: 20, stamp: 'a'.repeat(64) }], recipe: { template: 'media-sizes-v1', sourceIds: [20] } };
  assert.deepEqual(validateImageManifest(self, { draft: true }), self);
  for (const sourceIds of [[10], [10, 20], [20, 10]]) {
    const foreign = { ...self, sourceIds, sourceStamps: sourceIds.map(id => ({ id, stamp: 'a'.repeat(64) })), recipe: { ...self.recipe, sourceIds } };
    assert.throws(() => validateImageManifest(foreign, { draft: true }), error => error.code === 'invalid_image_asset');
  }
});

test('bounded PNG JPEG and WebP headers and dimensions match approved bytes', () => {
  const png = raster.png(40, 30), jpeg = Buffer.from([255,216,255,192,0,11,8,0,30,0,40,1,1,17,0,255,217]);
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.writeUInt32LE(22,4); webp.write('WEBPVP8X',8); webp.writeUInt32LE(10,16); webp.writeUIntLE(39,24,3); webp.writeUIntLE(29,27,3);
  for (const [mimeType, bytes] of [['image/png',png],['image/jpeg',jpeg],['image/webp',webp]]) {
    const variant={name:'w40',width:40,height:30,mimeType,byteLength:bytes.length,sha256:raster.sha256(bytes)};
    assert.equal(validateImageBytes(bytes,variant),bytes);
    assert.throws(()=>validateImageBytes(bytes,{...variant,width:41}),error=>error.code==='image_integrity');
    assert.throws(()=>validateImageBytes(Buffer.from('<svg/>'),variant),error=>error.code==='image_integrity');
    assert.deepEqual(decodeImageVariant(bytes.toString('base64'),validateImageVariant(variant,{withId:false})),bytes);
    assert.throws(()=>decodeImageVariant(bytes.toString('base64')+'\n',variant));
  }
});

test('source hashes run only on explicit phases while upload checks use metadata Open', async () => {
  const bytes=raster.png(4,6);let originals=0,metadata=0,anonymous=0;
  const source={Id:10,Type:'MediaItem',CoverImageBin:{ContentType:'image/png'}};
  const images=new ImageAssets({imageSourceSnapshot:async()=>{metadata++;return source;},coverBytes:async()=>{originals++;return bytes;},anonymousRead:async()=>{anonymous++;}});
  const value={sourceStamps:[{id:10,stamp:raster.sha256(bytes)}]};
  await images.assertSources(value); assert.equal(originals,0);
  await images.assertSources(value,{stamps:true,publicOwner:true});assert.equal(originals,1);assert.equal(anonymous,1);assert.equal(metadata,2);
  await assert.rejects(images.assertSources({sourceStamps:[{id:10,stamp:'0'.repeat(64)}]},{stamps:true}),error=>error.code==='image_source_changed');
  source.CoverImageBin=null;await assert.rejects(images.assertSources(value),error=>error.code==='image_original_required');
});

test('snapshots hash only pointer metadata and make no schema or native image operation calls', async () => {
  const projectRoot='/Root/Content/Images',generationId=randomUUID();
  const owner={Id:20,ParentId:2,Type:'Timeline',Name:'owner',Path:projectRoot+'/Timelines/owner',ModificationDate:'2026-11-06T00:00:00Z',Version:'V1.0',AllowedChildTypes:{results:[{Name:'File'},{Name:'Folder'}]}};
  const root={Id:30,ParentId:20,Name:'_images',Type:'Folder',Path:owner.Path+'/_images',Version:'V1.0',Description:JSON.stringify({protocol:'timeline-image-assets-v1',projectPath:projectRoot,ownerId:20,activeSetId:null,generationId:null,selectionRevision:generationId})};
  const calls=[],repo=new StockRepository({projectRoot,repositoryUrl:'https://fixture.invalid'},null);repo.assert=async()=>{};
  repo.api=async(target,operation)=>{calls.push({target,operation});assert.equal(operation,null);if(typeof target==='string'&&target.endsWith('/(images)')){const error=new Error('Canonical root absent');error.status=404;throw error;}return typeof target==='string'?root:owner;};
  const before=await repo.read(20),internal=await repo.read(20,{image:false});assert.equal(before.revision,internal.revision);assert.equal(before.image.state,'legacy');
  root.Version='V100.0';root.ModificationDate='2027-01-01T00:00:00Z';assert.equal((await repo.read(20)).revision,before.revision);
  root.Description=JSON.stringify({...JSON.parse(root.Description),selectionRevision:randomUUID()});assert.notEqual((await repo.read(20,{image:false})).revision,before.revision);
  owner.AllowedChildTypes={results:[]};assert.equal((await repo.read(20)).ImageStorageEnabled,true,'filtered CTD references cannot hide managed images');
  delete owner.AllowedChildTypes;calls.length=0;await repo.read(20);assert.equal(calls.some(call=>typeof call.target==='string'),false);
});

test('reserved folder and generation path or owner substitution fail closed', async () => {
  const value=manifest(),owner={Id:20,Type:'Timeline',Path:value.projectPath+'/Timelines/owner',ImageStorageEnabled:true};
  const root=imageRoot(owner);
  const set={Id:31,ParentId:30,Type:'Folder',Name:value.generationId,Path:root.Path+'/'+value.generationId,Description:JSON.stringify({protocol:'timeline-image-assets-v1',manifest:value,sealed:false,ownerRevision:'sha256:'+'a'.repeat(64)})};
  const repo={paths:{root:value.projectPath},read:async()=>owner,assert:async()=>{},api:async(target)=>typeof target==='string'?root:set};
  const images=new ImageAssets(repo);assert.deepEqual((await images.set(31,20,{sources:false})).manifest.recipe.sourceIds,[10,11]);
  set.ParentId=999;await assert.rejects(images.set(31,20,{sources:false}),error=>error.code==='image_owner_mismatch');
  root.Description='foreign user content';images.invalidate(20);await assert.rejects(images.storage(owner),error=>error.code==='image_storage_collision');
});

test('a private Timeline flag never grants storage privacy when actual anonymous Open succeeds', async () => {
  const images=new ImageAssets({anonymousRead:async()=>({Id:20})});
  await assert.rejects(images.isPublic({Id:20,Type:'Timeline',IsVisible:false}),error=>error.code==='image_owner_privacy_conflict');
  assert.equal(await images.isPublic({Id:20,Type:'Timeline',IsVisible:true}),true);
  images.repo.anonymousRead=async()=>{const error=new Error('Denied');error.status=403;throw error;};
  assert.equal(await images.isPublic({Id:20,Type:'Timeline',IsVisible:false}),false);
});

test('public owners cannot copy privately readable source originals into public child storage', async () => {
  const images=new ImageAssets({imageSourceSnapshot:async()=>({CoverImageBin:{ContentType:'image/png'}}),anonymousRead:async()=>{const error=new Error('Denied');error.status=403;throw error;}});
  await assert.rejects(images.assertSources({sourceStamps:[{id:10,stamp:'a'.repeat(64)}]},{publicOwner:true}),error=>error.code==='image_source_not_public');
});

test('direct occurrence ordering excludes managed images but keeps all occurrences and rejects hidden access', async () => {
  const owner={Id:20,Type:'Timeline',Path:'/Root/Content/Images/Timelines/owner'},entries=[{Id:21,ParentId:20,Type:'TimelineEntry'},{Id:22,ParentId:20,Type:'TimelineEntry'}],managed=[{Id:30,ParentId:20,Type:'SystemFolder',IsSystemContent:true},{Id:31,ParentId:30,Type:'Folder',IsSystemContent:true},{Id:32,ParentId:31,Type:'File',IsSystemContent:true}];
  const repo=new StockRepository({projectRoot:'/Root/Content/Images'},null);repo.read=async id=>id===20?owner:entries.find(row=>row.Id===id);repo.inventoryRows=async()=>[...entries,...managed];
  let seen;repo.images.managedTree=async(_owner,rows)=>{seen=rows;return[];};repo.assert=async()=>{};
  assert.deepEqual((await repo.children(20,'order')).map(row=>row.Id),[21,22]);assert.deepEqual(seen,managed);
  repo.assert=async ops=>{if(ops.some(op=>op.target===22)){const error=new Error('Denied');error.status=403;throw error;}};
  await assert.rejects(repo.children(20,'order'),error=>error.code==='permission_denied');
});

test('media reference checks contain occurrence references only, never generated-copy source relationships', async () => {
  const repo=new StockRepository({projectRoot:'/Root/Content/Images'},null);repo.read=async()=>({Id:10,Type:'MediaItem'});repo.inventoryRows=async expression=>{assert.match(expression,/TypeIs:TimelineEntry/);assert.doesNotMatch(expression,/ImageVariant|SourceContents/);return[];};
  assert.equal((await repo.references(10)).hasReferences,false);
});

for (const legacy of [false, true]) test(`media deletion preflights ${legacy ? 'legacy Folder' : 'SystemFolder'} storage and refuses foreign or denied descendants`, async () => {
  const value={...manifest(),kind:'media-sizes',sourceIds:[20],sourceStamps:[{id:20,stamp:'a'.repeat(64)}],recipe:{template:'media-sizes-v1',sourceIds:[20]}};
  const owner={Id:20,Type:'MediaItem',Path:value.projectPath+'/MediaLibrary/owner',ImageStorageEnabled:true};
  const root=imageRoot(owner,{legacy});
  const set={Id:31,ParentId:30,Type:'Folder',Name:value.generationId,Path:root.Path+'/'+value.generationId,Description:JSON.stringify({protocol:'timeline-image-assets-v1',manifest:value,sealed:false,ownerRevision:'sha256:'+'a'.repeat(64)})};
  const file={Id:32,ParentId:31,Type:'File',Name:'w400.png',Path:set.Path+'/w400.png'},nodes=[root,set,file];let denied=false;
  let changedType=false;
  const repo={paths:{root:value.projectPath},api:async target=>{if(typeof target==='string'){if(legacy&&target.endsWith('/(images)')){const error=new Error('Canonical root absent');error.status=404;throw error;}return root;}const node=nodes.find(row=>row.Id===target);return changedType&&target===root.Id?{...node,Type:legacy?'SystemFolder':'Folder'}:node;},assert:async ops=>{assert.equal(ops.some(op=>op.action==='cover'),false,'ordinary deletion does not invent owner Save');if(denied&&ops.some(op=>op.target===32&&op.action==='delete')){const error=new Error('Denied');error.status=403;throw error;}}};
  const images=new ImageAssets(repo);assert.deepEqual((await images.managedTree(owner,nodes,{deleting:true})).map(row=>row.id),[30,31,32]);
  denied=true;await assert.rejects(images.managedTree(owner,nodes,{deleting:true}),error=>error.status===403);
  denied=false;changedType=true;await assert.rejects(images.managedTree(owner,nodes,{deleting:true}),error=>error.code==='unexpected_children');
  changedType=false;file.Name='original.png';file.Path=set.Path+'/'+file.Name;await assert.rejects(images.managedTree(owner,nodes,{deleting:true}),error=>error.code==='unexpected_children');
});

test('delete receipts observe the exact target ID rather than a missing or renamed storage root', async () => {
  const images=new ImageAssets({});images.owner=async()=>({Id:20});images.node=async()=>({Id:31});images.set=async()=>{const error=new Error('Root missing');error.status=404;throw error;};
  const payload={action:'image-delete',targetId:20,setId:31};
  await assert.rejects(images.reconcile(payload),error=>error.code==='uncertain_image_mutation');
  images.node=async()=>{const error=new Error('Exact ID missing');error.status=404;throw error;};
  assert.equal((await images.reconcile(payload)).deleted,true);
});

test('known AddNew denial is checked before any owner child-setting mutation or original hash read', async () => {
  let writes=0,originals=0;
  const owner={Id:20,Type:'Timeline',Path:'/Root/Content/Images/Timelines/owner'};
  const repo={api:async(_target,operation,options)=>{if(options?.method)writes++;assert.equal(operation,'HasPermission');return false;},revisionMatches:()=>{},coverBytes:async()=>{originals++;}};
  const images=new ImageAssets(repo);images.storage=async()=>null;images.owner=async()=>owner;
  await assert.rejects(images.ensureStorage(owner),error=>error.code==='permission_denied');
  await assert.rejects(images.before({action:'image-draft',targetId:20,manifest:manifest()}),error=>error.code==='permission_denied');
  assert.equal(writes,0);assert.equal(originals,0);
});

test('stock generic File MIME is inferred from approved raster bytes without relabeling a known mismatch', async () => {
  const bytes=raster.png(40,30),variant={id:32,name:'w40',width:40,height:30,mimeType:'image/png',byteLength:bytes.length,sha256:raster.sha256(bytes)},set={Id:31,Path:'/owner/_images/generation'};
  const file={Id:32,ParentId:31,Type:'File',Name:'w40.png',Path:set.Path+'/w40.png'};let contentType='application/octet-stream';
  const images=new ImageAssets({api:async()=>file,config:{repositoryUrl:'https://fixture.invalid'},request:async()=>({bytes,contentType})});
  assert.equal((await images.file(set,variant)).bytes,bytes);contentType='image/jpeg';
  await assert.rejects(images.file(set,variant),error=>error.code==='image_integrity');
});
