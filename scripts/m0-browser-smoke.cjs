'use strict';

// Real local browser/API regression. Never uses a user's browser profile or remote repository.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const local = require('./m0-local-api.cjs');
const { permissions, READ_PERMISSIONS, WRITE_PERMISSIONS } = require('./m0-acl.cjs');
const playwright = require(process.env.M0_PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright'));
const chromiumParts=['ms-playwright','chromium-1234','chrome-win64','chrome.exe'];
const chromiumLocalAppData=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),...chromiumParts);
const chromiumDefault=fs.existsSync(chromiumLocalAppData)?chromiumLocalAppData:path.join(os.homedir(),'AppData','Local',...chromiumParts);

const FRONTEND = 'https://localhost:8080';
const ROOT = '/Root/Content/timelines';
const TIMELINES = ROOT + '/Timelines';
const MEDIA = ROOT + '/MediaLibrary';
const VISITOR = '/Root/IMS/BuiltIn/Portal/Visitor';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ6kAAAAASUVORK5CYII=','base64');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const nativeOpenReadDenied = response => response.status===400
  && response.value?.error?.code==='RequestError'
  && response.value?.error?.exceptiontype==='SenseNetSecurityException'
  && typeof response.value?.error?.message?.value==='string'
  && response.value.error.message.value.includes('M0 content open is not permitted.');

async function smoke() {
  const accounts = local.readAccounts();
  const id = crypto.randomUUID();
  const prefix = 'm0-browser-' + id;
  const output = path.join(local.ROOT, 'browser-smoke', id);
  fs.mkdirSync(output, { recursive: true });
  const report = { ranAt: new Date().toISOString(), frontend: FRONTEND, repository: local.REPOSITORY, fixturePrefix: prefix, checks: [], passed: false };
  const secrets = Object.values(accounts).flatMap(account => [account.password, account.apiKey, account.token]).filter(value => typeof value === 'string' && value.length > 7);
  const redact = value => secrets.reduce((result, secret) => result.replaceAll(secret, '[redacted]'), String(value))
    .replace(/([?&](?:code|auth_code|state|session_state|access_token|refresh_token|id_token)=)[^&"\s]+/gi,'$1[redacted]');
  const created = [];
  const fixtureIds = new Map();
  const contexts = [];
  const sessions = [];
  let browser;
  const checked = async (name, action,kind='real backend and browser UI',continueAfterFailure=false) => {
    try { await action(); report.checks.push({ name,kind,passed: true }); console.log(JSON.stringify({check:name,passed:true})); }
    catch (error) {
      const failure=name+': '+redact(error.message);report.checks.push({name,kind,passed:false,error:redact(error.message)});
      if(continueAfterFailure){report.failure=report.failure||failure;console.log(JSON.stringify({check:name,passed:false,error:redact(error.message)}));return;}
      throw new Error(failure);
    }
  };
  const create = async (parent, name, type, fields = {}) => {
    assert.ok(name.startsWith(prefix), 'Only this run UUID may be provisioned.');
    const content = await local.api(parent, { method: 'POST', account: accounts.admin, query: { metadata: 'no' }, body: { __ContentType: type, Name: name, ...fields } });
    created.push(content.Path || parent + '/' + name);
    fixtureIds.set(content.Path || parent + '/' + name,content.Id);
    return content;
  };
  const collection = async (query,collectionPath='/Root/Content') => {
    const response=await local.request(local.REPOSITORY+'/OData.svc'+collectionPath+'?'+new URLSearchParams({metadata:'no',...query}),{account:accounts.admin});
    assert.equal(response.status,200,'Local collection query failed.');return response.value.d;
  };
  const sourceCount = async () => Number((await collection({query:`+InTree:${ROOT} .AUTOFILTERS:OFF .LIFESPAN:OFF`,$select:'Id',$top:1,$inlinecount:'allpages'})).__count);
  report.sourceCountBefore = await sourceCount();
  const assertOpenDenied = async (target,targetKind) => {
    assert.ok([...fixtureIds.values()].includes(target),'Read revocation must target an isolated existing fixture.');
    const existing=await local.api(target,{account:accounts.admin,query:{$select:'Id',metadata:'no'}});
    assert.equal(existing.Id,target,'The revoked fixture must still exist.');
    const acl=await local.api(target,{operation:'GetAcl',account:accounts.admin});
    const editorRow=acl.entries.find(entry=>entry.identity.path===accounts.editor.path);
    for(const name of ['Open','OpenMinor','Save'])assert.equal(editorRow?.permissions[name]?.value,'deny','Admin ACL must prove the concrete editor '+name+' deny.');
    const permission=await local.request(local.endpoint(target)+'/HasPermission?'+new URLSearchParams({permissions:'Open'}),{account:accounts.editor});
    const permissionFalse=permission.status===200&&permission.value?.d===false;
    assert.ok(permissionFalse||nativeOpenReadDenied(permission),'Open precondition returned unexpected status/type: HTTP '+permission.status);
    report.permissionReadDenials=report.permissionReadDenials||[];
    report.permissionReadDenials.push({targetKind,adminFixtureExists:true,adminAclOpenOpenMinorSaveDenied:true,status:permission.status,permissionFalse,nativePolicyDeny:nativeOpenReadDenied(permission),code:permission.value?.error?.code,exceptiontype:permission.value?.error?.exceptiontype});
  };
  const denied = [{ identity: VISITOR, See:'deny', Open:'deny', OpenMinor:'deny', SeePermissions:'deny' }, { identity:accounts.reader.path, See:'deny', Open:'deny', OpenMinor:'deny', SeePermissions:'deny' }];
  const getEntries = async timeline => {
    assert.ok(timeline.startsWith(TIMELINES+'/'+prefix),'Only isolated timeline entries may be registered.');
    const result=await collection({query:`+TypeIs:TimelineEntry +InTree:"${timeline}"`,$select:'Id,Name,Path,Position,Notes,MediaItem/Id',$expand:'MediaItem',$orderby:'Position,Id',$top:100},timeline);
    const knownIds=new Set(fixtureIds.values());
    for(const entry of result.results){
      const belongs=typeof entry.Path==='string'&&entry.Path.startsWith(timeline+'/');
      assert.ok(belongs||knownIds.has(entry.Id),'Entry query returned an unknown target outside the isolated timeline.');
      // Index polling may briefly return a known deleted entry's new Trash path.
      // Its original canonical path and ID already own the scoped cleanup record.
      if(!belongs)continue;
      if(!created.includes(entry.Path))created.push(entry.Path);fixtureIds.set(entry.Path,entry.Id);
    }
    return result;
  };
  const expectNoWrites = (session, mark = 0) => {
    assert.equal(session.writes.length, mark, 'Denied browser flow attempted a native apply.');
    assert.equal(session.rawMutations.length, 0, 'The browser sent a raw repository mutation.');
  };
  const expectDeniedPage = async page => {
    await page.getByRole('status').filter({ hasText:'This operation is unavailable' }).waitFor();
    await wait(500);
  };
  const session = async () => {
    const context = await browser.newContext({ acceptDownloads: true, viewport:{width:1440,height:1050} });
    contexts.push(context);
    const page = await context.newPage();
    const writes = [];
    const rawMutations = [];
    const providerRequests = [];
    const nativePlans = new Map();
    const forbidden = [];
    const externalRequests=[];
    const imageHeaders = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (!['https://localhost:8080', local.REPOSITORY, local.AUTHORITY].includes(url.origin)) {
        externalRequests.push(url.origin);
        if (url.hostname.endsWith('sensenet.cloud') || url.hostname === 'auth.sensenet.com') forbidden.push(url.origin);
        return route.abort();
      }
      return route.continue();
    });
    page.on('request', async request => {
      const url = new URL(request.url());
      if (url.origin === local.REPOSITORY && ['POST','PUT','PATCH','DELETE'].includes(request.method())) rawMutations.push({method:request.method(),path:url.pathname});
      if(url.origin===FRONTEND&&request.method()==='POST') {
        const applied=url.pathname.match(/^\/api\/v1\/plans\/([^/]+)\/apply$/);
        if(applied)writes.push({method:'POST',path:url.pathname,planId:applied[1],targetIds:nativePlans.get(applied[1])?.targets||[]});
        if(url.pathname.startsWith('/api/v1/providers/'))providerRequests.push({path:url.pathname});
      }
      if(url.pathname==='/m0-external-cover-'+id+'.png'||(url.origin===local.REPOSITORY&&url.pathname.toLowerCase().includes('binaryhandler'))){
        const headers=await request.allHeaders().catch(()=>null);
        if(headers)imageHeaders.push({repository:url.origin===local.REPOSITORY,bearer:headers.authorization?.startsWith('Bearer ')===true,cookie:!!headers.cookie});
      }
    });
    page.on('response', async response => {
      const request=response.request();const url=new URL(request.url());
      if(url.origin!==FRONTEND||!url.pathname.startsWith('/api/v1/')||!response.ok())return;
      const value=await response.json().catch(()=>null);const content=value?.d;
      if(request.method()==='POST'&&url.pathname==='/api/v1/plans'&&value?.id) {
        nativePlans.set(value.id,{targets:value.targets||[]});
        for(const write of writes)if(write.planId===value.id)write.targetIds=value.targets||[];
      }
      const applied=url.pathname.match(/^\/api\/v1\/plans\/([^/]+)\/apply$/);
      if(applied) {
        const write=writes.findLast(write=>write.planId===applied[1]);
        if(write)write.targetIds=[...new Set([...(write.targetIds||[]),...(value?.completed||[]).map(item=>item.result?.id).filter(Number.isSafeInteger)])];
      }
      const nativeContent=value?.data;
      const candidate=nativeContent&&typeof nativeContent==='object'&&!Array.isArray(nativeContent)?nativeContent:content;
      // Only the current run's unique title permits registering a browser-created fixture.
      if(candidate?.Path?.startsWith(ROOT+'/')&&typeof candidate.DisplayName==='string'&&candidate.DisplayName.includes(id)) {
        if(!created.includes(candidate.Path))created.push(candidate.Path);fixtureIds.set(candidate.Path,candidate.Id);
      }
    });
    page.on('dialog', dialog => dialog.accept());
    const session={context,page,writes,rawMutations,providerRequests,forbidden,imageHeaders,externalRequests};sessions.push(session);return session;
  };
  const gotoStable = async (page,url) => {
    try { await page.goto(url); }
    catch(error) {
      // Vite may replace a document while serving a newly optimized module. Accept only the same URL.
      if(!error.message.includes('interrupted by another navigation to "'+url+'"'))throw error;
      await page.waitForURL(url);await page.waitForLoadState('load');
    }
  };
  const login = async (session, role,allowExistingSession=false) => {
    const {page} = session;
    await gotoStable(page,FRONTEND + '/timelines');
    await page.getByRole('button', {name:/Login with/}).waitFor();
    await page.getByRole('button', {name:/Login with/}).click();
    if(allowExistingSession){
      // This follows an explicit Login click after the first form-authenticated session.
      const restored=await Promise.race([
        page.locator('input[name="Username"], input[type="email"]').first().waitFor({timeout:60_000}).then(()=>false),
        page.getByRole('button',{name:/Logout/}).waitFor({timeout:60_000}).then(()=>true),
      ]);
      if(restored){assert.equal(session.forbidden.length,0);return;}
    }
    await page.waitForURL(url => url.origin === local.AUTHORITY);
    // The official local IdentityServer uses repository LoginName despite its email placeholder.
    await page.locator('input[name="Username"], input[type="email"]').first().fill(accounts[role].loginUsername||accounts[role].username);
    await page.locator('input[type="password"]').fill(accounts[role].password);
    await page.getByRole('button', {name:/^Login$|^Log in$|^Sign in$/i}).click();
    await page.waitForURL(url => url.origin === FRONTEND, {timeout:60_000});
    await page.getByRole('button', {name:/Logout/}).waitFor({timeout:60_000});
    assert.equal(session.forbidden.length, 0, 'Browser attempted production authentication/repository access.');
  };
  const editorGoto = async (session, suffix) => {
    await gotoStable(session.page,FRONTEND + suffix);
    await session.page.getByRole('button', {name:/Logout/}).waitFor();
  };
  const editModal = page => page.getByRole('heading', {name:'Edit Timeline Entry',exact:true}).locator('..').locator('..');
  const appModules = async (page,paths) => {
    // Vite's timestamp is part of module identity. Reuse loaded URLs to exercise the live app instance.
    const urls=await page.evaluate(paths=>paths.map(path=>performance.getEntriesByType('resource').map(entry=>entry.name).reverse().find(url=>new URL(url).pathname===path)),paths);
    assert.ok(urls.every(Boolean),'Expected actual loaded application modules.');return urls;
  };
  const waitForWrites = async (session, count) => {
    for (let attempt=0; attempt<150 && session.writes.length<count; attempt++) await wait(100);
    assert.ok(session.writes.length >= count, 'Expected an actual native apply request.');
    assert.equal(session.rawMutations.length,0,'The browser sent a raw repository mutation.');
  };
  const until = async (predicate,message) => {
    for(let attempt=0;attempt<150;attempt++){if(await predicate())return;await wait(100);}
    throw new Error(message);
  };

  try {
    const publicTimeline = await create(TIMELINES, prefix + '-public', 'Timeline', {DisplayName:'M0 isolated public ' + id,IsVisible:true,SortOrder:'chronological'});
    const privateTimeline = await create(TIMELINES, prefix + '-private', 'Timeline', {DisplayName:'M0 private cached ' + id,IsVisible:false});
    await permissions(privateTimeline.Id, denied);
    const sharedMedia = await create(MEDIA, prefix + '-shared', 'MediaItem', {DisplayName:'M0 shared denied ' + id,Description:'Isolated shared target',MediaType:'movie',CoverImageUrl:local.AUTHORITY+'/m0-external-cover-'+id+'.png'});
    await permissions(sharedMedia.Id, [{identity:accounts.editor.path,...READ_PERMISSIONS}]);
    const sharedEntry = await create(publicTimeline.Path, prefix + '-shared-entry', 'TimelineEntry', {MediaItem:[sharedMedia.Id],Position:1});
    const privateMedia = await create(MEDIA, prefix + '-private-media', 'MediaItem', {DisplayName:'M0 private media cached ' + id,Description:'M0_PRIVATE_METADATA_' + id,MediaType:'movie'});
    await permissions(privateMedia.Id, denied);
    await local.upload(MEDIA,{name:privateMedia.Name,bytes:PNG,contentType:'MediaItem',field:'CoverImageBin',contentId:privateMedia.Id,mime:'image/png',account:accounts.admin});

    browser = await playwright.chromium.launch({headless:true,executablePath:process.env.M0_CHROMIUM_EXECUTABLE_PATH || chromiumDefault});
    const visitor = await session();
    await checked('Visitor startup uses trusted HTTPS and sends no repository mutations', async () => {
      await gotoStable(visitor.page,FRONTEND + '/timelines');
      await visitor.page.getByRole('button', {name:/Login with/}).waitFor();
      await visitor.page.getByRole('status').filter({hasText:'Writes enabled'}).waitFor();
      await visitor.page.getByText('Timeline Theories',{exact:true}).first().waitFor();
      await wait(1500);
      expectNoWrites(visitor);
      assert.equal(visitor.forbidden.length,0);
    });
    await checked('Visitor timeline export/Trakt import stay hidden and direct create routes deny without a write', async () => {
      await gotoStable(visitor.page,FRONTEND+'/timelines/'+publicTimeline.Name);
      await visitor.page.getByText(publicTimeline.DisplayName,{exact:true}).waitFor();
      assert.equal(await visitor.page.getByRole('button',{name:'Export Timeline',exact:true}).count(),0);
      assert.equal(await visitor.page.getByTitle('Import from Trakt List',{exact:true}).count(),0);
      expectNoWrites(visitor);
      for (const route of ['/create','/media-library/create','/timelines/'+publicTimeline.Name+'/add-entry']) {
        await gotoStable(visitor.page,FRONTEND+route); await expectDeniedPage(visitor.page); expectNoWrites(visitor);
      }
      await visitor.page.screenshot({path:path.join(output,'visitor-denied.png')});
    });
    await checked('Visitor opens restored Death Wish subfolder media directly and through its timeline card',async()=>{
      const mediaName='Death Wish (1974)';
      const timelineName='Charles Bronson-s Death Wish';
      const mediaUrl=FRONTEND+'/media-library/'+encodeURIComponent(mediaName);
      await gotoStable(visitor.page,mediaUrl);
      await visitor.page.getByRole('heading',{name:mediaName,exact:true}).waitFor();
      expectNoWrites(visitor);
      await gotoStable(visitor.page,FRONTEND+'/timelines/'+encodeURIComponent(timelineName));
      await visitor.page.getByText("Charles Bronson's Death Wish",{exact:true}).waitFor();
      assert.equal(await visitor.page.getByRole('button',{name:'Export Timeline',exact:true}).count(),0);
      assert.equal(await visitor.page.getByTitle('Import from Trakt List',{exact:true}).count(),0);
      await visitor.page.getByRole('link',{name:mediaName,exact:true}).last().click();
      await visitor.page.waitForURL(mediaUrl);
      await visitor.page.getByRole('heading',{name:mediaName,exact:true}).waitFor();
      expectNoWrites(visitor);
      const documentTimeOrigin=await visitor.page.evaluate(()=>performance.timeOrigin);
      const missingUrl=FRONTEND+'/media-library/'+encodeURIComponent(prefix+'-missing');
      // Exercise route state changes without a document reload, including recovery
      // after an unavailable Name; a late result must belong to its own slug.
      await visitor.page.evaluate(url=>{history.pushState(history.state,'',url);window.dispatchEvent(new PopStateEvent('popstate'));},missingUrl);
      await visitor.page.getByRole('heading',{name:'Media Item Unavailable',exact:true}).waitFor();
      await visitor.page.getByRole('status').filter({hasText:'This operation is unavailable with your current permissions.'}).waitFor();
      assert.equal(await visitor.page.getByRole('heading',{name:mediaName,exact:true}).count(),0);
      expectNoWrites(visitor);
      await visitor.page.evaluate(url=>{history.pushState(history.state,'',url);window.dispatchEvent(new PopStateEvent('popstate'));},mediaUrl);
      await visitor.page.getByRole('heading',{name:mediaName,exact:true}).waitFor();
      assert.equal(await visitor.page.evaluate(()=>performance.timeOrigin),documentTimeOrigin);
      expectNoWrites(visitor);
      report.sourceMediaReadRegression={mediaName,timelineName,directRoute:true,timelineCardRoute:true,sameDocumentUnavailableRecovery:true,repositoryMutations:0};
      await visitor.page.screenshot({path:path.join(output,'visitor-source-subfolder-media.png')});
    },'real Visitor local restored source read only; no source mutations');
    for(const fault of [404,401,403,500,'abort'])await checked(`Startup GET fault ${fault} fails closed with zero writes`,async()=>{
      const isolated=await session();let injected=0;
      await isolated.context.route(local.REPOSITORY+'/**',route=>{
        if(route.request().method()!=='GET')return route.fallback();
        injected++;
        return fault==='abort'?route.abort('connectionfailed'):route.fulfill({status:fault,contentType:'application/json',body:JSON.stringify({error:{message:{value:'M0 injected read failure'}}})});
      });
      await gotoStable(isolated.page,FRONTEND+'/timelines');await expectDeniedPage(isolated.page);await wait(1000);
      assert.ok(injected>0,'No actual application GET was faulted.');expectNoWrites(isolated);
      await isolated.context.close();
    },'browser GET fault injection; does not replace backend success tests');
    const reader = await session();
    await checked('Reader signs in through the actual local OIDC LoginName/password form', async () => {await login(reader,'reader');expectNoWrites(reader);});
    await checked('Authenticated reader has no write controls and direct routes deny', async () => {
      await editorGoto(reader,'/timelines/'+publicTimeline.Name);
      await reader.page.getByText(publicTimeline.DisplayName,{exact:true}).waitFor();
      await reader.page.getByRole('button',{name:'Export Timeline',exact:true}).waitFor();
      assert.equal(await reader.page.getByTitle('Import from Trakt List',{exact:true}).count(),0);
      assert.equal(await reader.page.getByTitle('Edit Timeline',{exact:true}).count(),0);
      assert.equal(await reader.page.getByTitle('Add Timeline Entry',{exact:true}).count(),0);
      assert.equal(await reader.page.getByTitle('Delete Entry',{exact:true}).count(),0);
      for (const route of ['/create','/media-library/create','/timelines/'+publicTimeline.Name+'/add-entry']) {await gotoStable(reader.page,FRONTEND+route);await expectDeniedPage(reader.page);}
      expectNoWrites(reader);
      await reader.page.screenshot({path:path.join(output,'reader-denied.png')});
    });
    const editor = await session();
    await checked('Editor signs in through the actual local OIDC flow', () => login(editor,'editor'));
    let uiTimeline;
    let uiMedia;
    let archive;
    const uiSlug = prefix + '-ui';
    const uiTitle = 'M0 browser UI ' + id;
    const mediaTitle = 'M0 browser media ' + id;
    let currentMediaTitle=mediaTitle;
    let libraryTitle=mediaTitle;
    await checked('Editor creates a timeline through the UI and backend confirms it', async () => {
      await editorGoto(editor,'/create');
      await editor.page.getByPlaceholder('Enter timeline title...').fill(uiTitle);
      await editor.page.getByPlaceholder('Enter timeline url slug...').fill(uiSlug);
      await editor.page.getByRole('button',{name:'Create Timeline',exact:true}).click();
      await editor.page.waitForURL(FRONTEND+'/timelines/'+uiSlug);
      await editor.page.getByText(uiTitle,{exact:true}).waitFor();
      uiTimeline = await local.api(TIMELINES+'/'+uiSlug,{account:accounts.admin,query:{$select:'Id,Name,Path,DisplayName,IsVisible',metadata:'no'}});
      created.push(uiTimeline.Path);fixtureIds.set(uiTimeline.Path,uiTimeline.Id);
      assert.equal(uiTimeline.DisplayName,uiTitle);
    });
    await checked('New UI-created default-private timeline denies Visitor and reader metadata',async()=>{
      assert.equal(uiTimeline.IsVisible,false);
      for(const isolated of [visitor,reader]){
        const mark=isolated.writes.length;await gotoStable(isolated.page,FRONTEND+'/timelines/'+uiSlug);
        await isolated.page.getByRole('status').filter({hasText:'This timeline is unavailable'}).waitFor();
        assert.equal(await isolated.page.getByText(uiTitle,{exact:true}).count(),0);expectNoWrites(isolated,mark);
      }
    });
    await checked('Editor creates a media item and a timeline occurrence through add-entry UI', async () => {
      await editor.page.getByTitle('Add Timeline Entry',{exact:true}).click();
      await editor.page.getByRole('button',{name:'Create New Media',exact:true}).click();
      await editor.page.getByPlaceholder('Enter the title of your media item').fill(mediaTitle);
      await editor.page.getByPlaceholder('Describe your media item...').fill('Isolated browser-created media');
      await editor.page.getByPlaceholder('8',{exact:true}).fill('0');
      await editor.page.getByRole('button',{name:'Create Media Item',exact:true}).click();
      await editor.page.getByRole('button',{name:'Add to Timeline',exact:true}).waitFor();
      await editor.page.getByRole('button',{name:'Add to Timeline',exact:true}).click();
      await editor.page.waitForURL(FRONTEND+'/timelines/'+uiSlug);
      const entries = await getEntries(uiTimeline.Path); assert.equal(entries.results.length,1);
      const reference=entries.results[0].MediaItem;
      const mediaId = Array.isArray(reference)?reference[0].Id:reference.Id;
      uiMedia = await local.api(mediaId,{account:accounts.admin,query:{$select:'Id,Name,Path,DisplayName,Rating',metadata:'no'}});
      created.push(uiMedia.Path);fixtureIds.set(uiMedia.Path,uiMedia.Id);assert.equal(uiMedia.DisplayName,mediaTitle);
      assert.equal(uiMedia.Rating,0);
    });
    await checked('A second occurrence referencing the same media stays distinct', async () => {
      await editor.page.getByTitle('Add Timeline Entry',{exact:true}).click();
      await editor.page.getByPlaceholder('Search media...', { exact: true }).fill(mediaTitle);
      await editor.page.getByRole('listitem').filter({hasText:mediaTitle}).getByRole('button',{name:'Select',exact:true}).click();
      await editor.page.locator('input[type="number"]').fill('2');
      await editor.page.getByRole('button',{name:'Add to Timeline',exact:true}).click();
      await editor.page.waitForURL(FRONTEND+'/timelines/'+uiSlug);
      const entries = (await getEntries(uiTimeline.Path)).results;
      assert.equal(entries.length,2); assert.notEqual(entries[0].Id,entries[1].Id); assert.notEqual(entries[0].Name,entries[1].Name);
    });
    await checked('Timeline and entry edits persist through the UI', async () => {
      await editor.page.getByTitle('Edit Timeline',{exact:true}).click();
      await editor.page.locator('form input[type="text"]').first().fill(uiTitle+' edited');
      await editor.page.getByRole('button',{name:'Save',exact:true}).click();
      await editor.page.getByText(uiTitle+' edited',{exact:true}).waitFor();
      await editor.page.getByTitle('Edit Entry',{exact:true}).first().click();
      await editor.page.getByPlaceholder('Optional notes about this entry...').fill('M0 browser entry saved');
      await editor.page.getByRole('button',{name:'Save Changes',exact:true}).click();
      await editor.page.getByRole('heading',{name:'Edit Timeline Entry',exact:true}).waitFor({state:'hidden'});
      const entries=(await getEntries(uiTimeline.Path)).results;assert.ok(entries.some(entry=>entry.Notes==='M0 browser entry saved'));
    });
    await checked('Keyboard reorder persists the complete entry order', async () => {
      const before=(await getEntries(uiTimeline.Path)).results;
      await editor.page.getByTitle('Reorder Entries',{exact:true}).click();
      await until(async()=>await editor.page.locator('[data-rbd-drag-handle-draggable-id]').count()===2,'Readable draggable entries did not mount.');
      const handle=editor.page.locator('[data-rbd-drag-handle-draggable-id]').first();
      await handle.focus();await handle.press('Space');await handle.press('ArrowDown');await wait(350);await handle.press('Space');
      await editor.page.getByTitle('Save New Order',{exact:true}).click();
      await editor.page.getByTitle('Reorder Entries',{exact:true}).waitFor();
      const after=(await getEntries(uiTimeline.Path)).results;assert.deepEqual(after.map(entry=>entry.Id),before.map(entry=>entry.Id).reverse());
    });
    await checked('Shared media edit and binary upload independently persist', async () => {
      await editor.page.getByTitle('Edit Entry',{exact:true}).first().click();
      await editor.page.getByRole('button',{name:'Media Item Data',exact:true}).click();
      const modal=editModal(editor.page);
      await modal.locator('input[type="text"]').first().fill(mediaTitle+' edited');
      await modal.getByRole('radio',{name:'Upload Image',exact:true}).check();
      await modal.locator('input[type="file"]').setInputFiles({name:'m0-cover.png',mimeType:'image/png',buffer:PNG});
      await modal.getByRole('button',{name:'Save Changes',exact:true}).click();
      await editor.page.getByRole('heading',{name:'Edit Timeline Entry',exact:true}).waitFor({state:'hidden'});
      const saved=await local.api(uiMedia.Id,{account:accounts.admin,query:{$select:'DisplayName,CoverImageBin',metadata:'no'}});
      assert.equal(saved.DisplayName,mediaTitle+' edited');assert.ok(saved.CoverImageBin?.__mediaresource?.media_src);
      currentMediaTitle=mediaTitle+' edited';
    });
    await checked('Standalone media title edit preserves existing Choice, dates, Year and Rating zero',async()=>{
      libraryTitle='M0 preserved clean title '+id;
      const fields={Title:libraryTitle,MediaType:'show',Genre:'other',Year:2021,ReleaseDate:'2021-08-09T12:34:56Z',ChronologicalDate:'2022-04-05T11:22:33Z',Rating:0,ExternalLinks:JSON.stringify({url:'https://example.invalid/'+id}),Tags:'m0-preserved'};
      await local.api(uiMedia.Id,{account:accounts.admin,method:'PATCH',body:fields});
      const before=await local.api(uiMedia.Id,{account:accounts.admin,query:{$select:Object.keys(fields).join(','),metadata:'no'}});
      await editorGoto(editor,'/media-library');await editor.page.getByPlaceholder('Search titles, descriptions...').fill(id);
      await editor.page.getByRole('button',{name:'Search',exact:true}).click();
      await editor.page.getByRole('heading',{name:libraryTitle,exact:true}).locator('..').getByRole('button',{name:'Edit',exact:true}).click();
      const dialog=editor.page.getByRole('heading',{name:'Edit Media Item',exact:true}).locator('..');
      assert.equal(await dialog.locator('select').nth(0).inputValue(),'show');
      assert.equal(await dialog.locator('select').nth(1).inputValue(),'other');
      await editor.page.getByPlaceholder('Enter the title',{exact:true}).fill(currentMediaTitle+' standalone');
      const [request]=await Promise.all([editor.page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/plans'&&request.postDataJSON()?.commands?.some(command=>command.action==='update'&&command.targetId===uiMedia.Id)),editor.page.getByRole('button',{name:'Update Media Item',exact:true}).click()]);
      const payload=request.postDataJSON();assert.equal(payload.commands.length,1);assert.equal(payload.commands[0].targetId,uiMedia.Id);assert.deepEqual(Object.keys(payload.commands[0].fields),['DisplayName']);
      await editor.page.getByRole('heading',{name:'Edit Media Item',exact:true}).waitFor({state:'hidden'});
      currentMediaTitle+=' standalone';
      const after=await local.api(uiMedia.Id,{account:accounts.admin,query:{$select:Object.keys(fields).join(','),metadata:'no'}});assert.deepEqual(after,before);
      await editorGoto(editor,'/timelines/'+uiSlug);await editor.page.getByTitle('Edit Entry',{exact:true}).first().waitFor();
    });
    await checked('ZIP export and import preserve both occurrence identities', async () => {
      const before=(await getEntries(uiTimeline.Path)).results;
      const [download]=await Promise.all([editor.page.waitForEvent('download'),editor.page.getByRole('button',{name:'Export Timeline',exact:true}).click()]);
      archive=path.join(output,'fixture-timeline.zip');await download.saveAs(archive);
      const mark=editor.writes.length;
      await editor.page.locator('input[type="file"][accept=".zip"]').setInputFiles(archive);
      await waitForWrites(editor,mark+1);
      await editor.page.getByText('Importing...',{exact:true}).waitFor({state:'hidden'});
      const after=(await getEntries(uiTimeline.Path)).results;assert.deepEqual(after.map(entry=>entry.Id),before.map(entry=>entry.Id));
      assert.equal(after.length,2);
      assert.equal(editor.writes.length,mark+1,'ZIP import must use one explicit native plan apply.');
      await until(()=>before.every(entry=>editor.writes.at(-1).targetIds.includes(entry.Id)),'Native ZIP apply did not name both existing occurrence targets.');
      await editor.page.getByText(currentMediaTitle,{exact:true}).first().waitFor();
      await editor.page.screenshot({path:path.join(output,'editor-crud-timeline.png')});
    });
    await checked('Mixed entry Save rights stop reorder and ZIP import before any write',async()=>{
      const before=(await getEntries(uiTimeline.Path)).results;const deniedEntry=before[1];
      await editor.page.getByTitle('Reorder Entries',{exact:true}).click();
      await permissions(deniedEntry.Id,[{identity:accounts.editor.path,...READ_PERMISSIONS}]);
      let mark=editor.writes.length;
      await editor.page.getByTitle('Save New Order',{exact:true}).click();
      await editor.page.getByText('Permission denied or unavailable',{exact:true}).waitFor();expectNoWrites(editor,mark);
      assert.deepEqual((await getEntries(uiTimeline.Path)).results.map(entry=>[entry.Id,entry.Position]),before.map(entry=>[entry.Id,entry.Position]));
      await permissions(deniedEntry.Id,[{identity:accounts.editor.path,...WRITE_PERMISSIONS}]);
      await editorGoto(editor,'/timelines/'+uiSlug);await editor.page.getByTitle('Edit Entry',{exact:true}).first().waitFor();
      await permissions(deniedEntry.Id,[{identity:accounts.editor.path,...READ_PERMISSIONS}]);
      mark=editor.writes.length;await editor.page.locator('input[type="file"][accept=".zip"]').setInputFiles(archive);
      await editor.page.getByText('Permission denied or unavailable',{exact:true}).waitFor();expectNoWrites(editor,mark);
      assert.deepEqual((await getEntries(uiTimeline.Path)).results.map(entry=>[entry.Id,entry.Position]),before.map(entry=>[entry.Id,entry.Position]));
      await checked('Mutating public ZIP operation preview cannot bypass private mixed-target preflight',async()=>{
        await permissions(deniedEntry.Id,[{identity:accounts.editor.path,...WRITE_PERMISSIONS}]);
        const modules=await appModules(editor.page,['/services/sensenet.ts','/services/timelineImportService.ts']);
        const mutationMark=editor.writes.length;
        const prepared=await editor.page.evaluate(async ({modules,archive64,timelineId,parentPath,runId})=>{
          const core=await import(modules[0]);if(!core.repository.configuration.token)throw new Error('Expected actual authenticated application module.');
          const {prepareTimelineImport}=await import(modules[1]);
          const bytes=Uint8Array.from(atob(archive64),character=>character.charCodeAt(0));
          const plan=await prepareTimelineImport(new File([bytes],'fixture-timeline.zip',{type:'application/zip'}),timelineId,parentPath);
          globalThis.__m0ZipPreviewFixture={runId,plan};return{originalCount:plan.operations.length};
        },{modules,archive64:fs.readFileSync(archive).toString('base64'),timelineId:uiTimeline.Id,parentPath:uiTimeline.Path,runId:id});
        assert.ok(prepared.originalCount>0);expectNoWrites(editor,mutationMark);
        await permissions(deniedEntry.Id,[{identity:accounts.editor.path,...READ_PERMISSIONS}]);
        const outcome=await editor.page.evaluate(async ({runId})=>{
          const fixture=globalThis.__m0ZipPreviewFixture;delete globalThis.__m0ZipPreviewFixture;
          if(fixture?.runId!==runId)throw new Error('Expected this run\'s prepared ZIP fixture');
          const plan=fixture.plan,originalCount=plan.operations.length;plan.operations.length=0;
          try{await plan.execute();return{denied:false,originalCount};}
          catch(error){return{denied:error.message==='Permission denied or unavailable',originalCount};}
        },{runId:id});
        assert.equal(outcome.denied,true);assert.ok(outcome.originalCount>0);expectNoWrites(editor,mutationMark);
        assert.deepEqual((await getEntries(uiTimeline.Path)).results.map(entry=>[entry.Id,entry.Position]),before.map(entry=>[entry.Id,entry.Position]));
      },'actual authenticated app ZIP plan public-preview mutation and real backend ACL');
      await permissions(deniedEntry.Id,[{identity:accounts.editor.path,...WRITE_PERMISSIONS}]);
      await editorGoto(editor,'/timelines/'+uiSlug);await editor.page.getByTitle('Edit Entry',{exact:true}).first().waitFor();
    });
    await checked('Entry Delete UI removes only the selected isolated occurrence', async () => {
      const before=(await getEntries(uiTimeline.Path)).results;
      await editor.page.getByTitle('Delete Entry',{exact:true}).first().click();
      await until(async()=>(await getEntries(uiTimeline.Path)).results.length===1&&await editor.page.getByTitle('Delete Entry',{exact:true}).count()===1,'Deleted occurrence remained in the UI/backend.');
      const after=(await getEntries(uiTimeline.Path)).results;assert.equal(after.length,1);
      assert.ok(before.some(entry=>entry.Id===after[0].Id));
    });
    await checked('Actual bulk service preflights both media targets before provider fetch or first write',async()=>{
      const select='DisplayName,Description,MediaType,Genre,Year,ReleaseDate,CoverImageBin,Rating';
      const before=await Promise.all([uiMedia.Id,sharedMedia.Id].map(target=>local.api(target,{account:accounts.admin,query:{$select:select,metadata:'no'}})));
      const mark=editor.writes.length;const providerMark=editor.providerRequests.length;const externalMark=editor.externalRequests.length;
      const modules=await appModules(editor.page,['/services/sensenet.ts','/services/mediaLibraryService.ts','/services/mediaUpdateService.ts']);
      const result=await editor.page.evaluate(async ({targets,modules})=>{
        const core=await import(modules[0]);if(!core.repository.configuration.token)throw new Error('Expected actual authenticated application module.');
        const {MediaLibraryService}=await import(modules[1]);const {MediaUpdateService}=await import(modules[2]);
        const items=await Promise.all(targets.map(target=>MediaLibraryService.getMediaItem(target)));let progress=0;
        try{await MediaUpdateService.processBulkUpdate(items,{updateTitles:true,updateDescriptions:true,updateCoverImages:true,onlyMissing:false,preferredSources:['omdb'],coverImageMode:'binary'},()=>progress++,false);return{denied:false,progress};}
        catch(error){return{denied:error.message==='Permission denied or unavailable',progress};}
      },{targets:[uiMedia.Id,sharedMedia.Id],modules});
      assert.deepEqual(result,{denied:true,progress:0});expectNoWrites(editor,mark);assert.equal(editor.providerRequests.length,providerMark,'Native bulk provider request began before complete target preflight.');assert.equal(editor.externalRequests.length,externalMark,'External provider request began before complete target preflight.');
      const after=await Promise.all([uiMedia.Id,sharedMedia.Id].map(target=>local.api(target,{account:accounts.admin,query:{$select:select,metadata:'no'}})));assert.deepEqual(after,before);
    },'actual authenticated app service and real backend ACL; provider success is deferred');
    await checked('Entry-only rights do not authorize shared media Save or upload', async () => {
      await editorGoto(editor,'/timelines/'+publicTimeline.Name);
      await editor.page.getByTitle('Edit Entry',{exact:true}).click();
      assert.equal(await editor.page.getByRole('button',{name:'Media Item Data',exact:true}).isDisabled(),true);
      await editor.page.getByPlaceholder('Optional notes about this entry...').fill('Entry-only permitted update');
      const mark=editor.writes.length;await editor.page.getByRole('button',{name:'Save Changes',exact:true}).click();
      await editor.page.getByRole('heading',{name:'Edit Timeline Entry',exact:true}).waitFor({state:'hidden'});
      assert.equal(editor.writes.length,mark+1);
      await until(()=>editor.writes.at(-1).targetIds.includes(sharedEntry.Id),'Native entry apply did not name its actual occurrence target.');
      assert.deepEqual(editor.writes.at(-1).targetIds,[sharedEntry.Id]);assert.equal(editor.rawMutations.length,0);
      assert.equal((await local.api(sharedEntry.Id,{account:accounts.admin,query:{$select:'Notes',metadata:'no'}})).Notes,'Entry-only permitted update');
      const saved=await local.api(sharedMedia.Id,{account:accounts.admin,query:{$select:'DisplayName',metadata:'no'}});assert.equal(saved.DisplayName,sharedMedia.DisplayName);
    });
    await checked('External cover fetch never receives repository bearer credentials',async()=>{
      await editorGoto(editor,'/media-library/'+sharedMedia.Name);
      await editor.page.getByText(sharedMedia.DisplayName,{exact:true}).first().waitFor();
      await until(()=>editor.imageHeaders.some(image=>!image.repository),'Actual external-origin cover request was not observed.');
      assert.equal(editor.imageHeaders.filter(image=>!image.repository).some(image=>image.bearer),false,'Repository bearer was sent to an external image origin.');
      assert.equal(editor.imageHeaders.filter(image=>!image.repository).some(image=>image.cookie),false,'Cookies were sent to an external cover fetch.');
    });
    await checked('Unknown HasPermission prevents combined shared Save and upload',async()=>{
      await editorGoto(editor,'/timelines/'+uiSlug);await editor.page.getByTitle('Edit Entry',{exact:true}).first().click();
      await editor.page.getByRole('button',{name:'Media Item Data',exact:true}).click();const modal=editModal(editor.page);
      await modal.locator('input[type="text"]').first().fill('Unknown permission must not save');
      await modal.getByRole('radio',{name:'Upload Image',exact:true}).check();await modal.locator('input[type="file"]').setInputFiles({name:'unknown-must-not-upload.png',mimeType:'image/png',buffer:PNG});
      const permissionPath=new URL(local.endpoint(uiMedia.Id)+'/HasPermission').pathname.toLowerCase();
      let injected=0;const routeHandler=route=>{
        const url=new URL(route.request().url());
        if(route.request().method()==='GET'&&url.pathname.toLowerCase()===permissionPath&&url.searchParams.get('permissions')?.includes('Save')){
          injected++;return route.fulfill({status:500,contentType:'application/json',body:'{"error":{"message":{"value":"M0 injected unknown permission"}}}'});
        }
        return route.fallback();
      };
      await editor.context.route(local.REPOSITORY+'/**',routeHandler);const mark=editor.writes.length;
      await modal.getByRole('button',{name:'Save Changes',exact:true}).click();await modal.getByText('M0 injected unknown permission',{exact:true}).waitFor();
      assert.ok(injected>0,'No actual HasPermission operation was faulted.');expectNoWrites(editor,mark);
      await editor.context.unroute(local.REPOSITORY+'/**',routeHandler);await modal.getByRole('button',{name:'Cancel',exact:true}).click();
    },'browser GET permission fault injection; actual Save handler');
    await checked('Revoked shared Save/upload preflight stops before the first browser write', async () => {
      await editorGoto(editor,'/timelines/'+uiSlug);
      await editor.page.getByTitle('Edit Entry',{exact:true}).first().click();await editor.page.getByRole('button',{name:'Media Item Data',exact:true}).click();
      const modal=editModal(editor.page);await modal.locator('input[type="text"]').first().fill('Must not be saved');
      await modal.getByRole('radio',{name:'Upload Image',exact:true}).check();await modal.locator('input[type="file"]').setInputFiles({name:'must-not-upload.png',mimeType:'image/png',buffer:PNG});
      await permissions(uiMedia.Id,[{identity:accounts.editor.path,...READ_PERMISSIONS}]);
      const mark=editor.writes.length;
      await modal.getByRole('button',{name:'Save Changes',exact:true}).click({timeout:3000});
      await modal.getByText('Permission denied or unavailable',{exact:true}).waitFor();expectNoWrites(editor,mark);
      const saved=await local.api(uiMedia.Id,{account:accounts.admin,query:{$select:'DisplayName',metadata:'no'}});assert.equal(saved.DisplayName,currentMediaTitle);
      await modal.getByRole('button',{name:'Cancel',exact:true}).click();
    });
    await checked('Actual captured operation context rejects a repository identity change',async()=>{
      const mark=editor.writes.length;
      const [coreUrl]=await appModules(editor.page,['/services/sensenet.ts']);
      const rejected=await editor.page.evaluate(async ({target,coreUrl})=>{
        const module=await import(coreUrl);
        if(!module.repository.configuration.token)throw new Error('Expected the actual authenticated application module.');
        const check=module.captureOperationContext();
        const pending=new Promise(resolve=>setTimeout(resolve,10));module.setRepositoryAccessToken('');await pending;
        try{check();}catch(error){return error.message==='Operation context changed; start again';}
        await module.repository.patch({idOrPath:target,content:{Notes:'Stale identity must not save'}});return false;
      },{target:sharedEntry.Id,coreUrl});
      assert.equal(rejected,true);expectNoWrites(editor,mark);
      await editor.page.reload();await editor.page.getByRole('button',{name:/Logout/}).waitFor();
    },'actual authenticated browser module context transition');
    await checked('Media and entry Open revocation hides cached card metadata and image while timeline stays readable',async()=>{
      await editorGoto(editor,'/timelines/'+uiSlug);await editor.page.getByText(currentMediaTitle,{exact:true}).waitFor();
      const openDenied={...READ_PERMISSIONS,Open:'deny',OpenMinor:'deny'};
      await permissions(uiMedia.Id,[{identity:accounts.editor.path,...openDenied}]);const mark=editor.writes.length;
      await assertOpenDenied(uiMedia.Id,'MediaItem');
      await checked('Backend expanded readable entry does not expose Open-denied referenced media fields',async()=>{
      const readableEntry=(await getEntries(uiTimeline.Path)).results[0];
      const entryOnly=await local.api(readableEntry.Id,{account:accounts.editor,query:{$select:'Id,DisplayName',metadata:'no'}});
      assert.equal(entryOnly.Id,readableEntry.Id,'Readable entry must remain accessible.');
      const expansion=await local.request(local.endpoint(readableEntry.Id)+'?'+new URLSearchParams({$expand:'MediaItem',$select:'Id,DisplayName,MediaItem/Id,MediaItem/DisplayName,MediaItem/Description',metadata:'no'}),{account:accounts.editor});
      assert.ok([200,403,404].includes(expansion.status)||nativeOpenReadDenied(expansion),'Protected-reference expansion returned unexpected HTTP '+expansion.status);
      const expanded=expansion.status===200?expansion.value.d:{};
      const references=Array.isArray(expanded.MediaItem)?expanded.MediaItem:(expanded.MediaItem?.results||[expanded.MediaItem]);
      const protectedFields=references.filter(Boolean).filter(reference=>reference.Id!==undefined&&reference.Id!==null||typeof reference.DisplayName==='string'&&reference.DisplayName.length>0||typeof reference.Description==='string'&&reference.Description.length>0);
      const referenceShape=references.filter(Boolean).map(reference=>Object.fromEntries(Object.entries(reference).map(([key,value])=>[key,value===null?'null':Array.isArray(value)?'array':typeof value])));
      report.referenceOpenAcl={status:expansion.status,nativePolicyDeny:nativeOpenReadDenied(expansion),entryDisplayNameExcludedFromReferenceCheck:true,entryFields:Object.keys(expanded),MediaItem:referenceShape};
      assert.equal(protectedFields.length,0,'Protected MediaItem expansion exposed Open-denied fields; response shape: '+JSON.stringify({entryFields:Object.keys(expanded),MediaItem:referenceShape}));
      },'real editor authenticated OData reference ACL',true);
      // Do not navigate/refetch: the bounded permission poll must remove already loaded content.
      await editor.page.getByText(currentMediaTitle,{exact:true}).waitFor({state:'hidden',timeout:35_000});
      assert.equal(await editor.page.getByRole('img',{name:currentMediaTitle,exact:true}).count(),0);
      await editor.page.getByText(uiTitle+' edited',{exact:true}).waitFor();expectNoWrites(editor,mark);
      await permissions(uiMedia.Id,[{identity:accounts.editor.path,...READ_PERMISSIONS}]);
      await editorGoto(editor,'/timelines/'+uiSlug);await editor.page.getByText(currentMediaTitle,{exact:true}).waitFor();
      const remaining=(await getEntries(uiTimeline.Path)).results[0];
      // Save implies Open on SenseNet; remove dependent write grants to revoke effective Open.
      await permissions(remaining.Id,[{identity:accounts.editor.path,...openDenied}]);
      await assertOpenDenied(remaining.Id,'TimelineEntry');
      await editor.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await editor.page.getByText(currentMediaTitle,{exact:true}).waitFor({state:'hidden'});
      assert.equal(await editor.page.getByRole('img',{name:currentMediaTitle,exact:true}).count(),0);
      await editor.page.getByText(uiTitle+' edited',{exact:true}).waitFor();expectNoWrites(editor,mark);
      await permissions(remaining.Id,[{identity:accounts.editor.path,...WRITE_PERMISSIONS}]);
      await editorGoto(editor,'/media-library');await editor.page.getByPlaceholder('Search titles, descriptions...').fill(id);
      await editor.page.getByRole('button',{name:'Search',exact:true}).click();await editor.page.getByRole('heading',{name:libraryTitle,exact:true}).waitFor();
      await permissions(uiMedia.Id,[{identity:accounts.editor.path,...openDenied}]);
      await editor.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await editor.page.getByRole('heading',{name:libraryTitle,exact:true}).waitFor({state:'hidden'});
      assert.equal(await editor.page.getByRole('img',{name:currentMediaTitle+' cover',exact:true}).count(),0);expectNoWrites(editor,mark);
      await permissions(uiMedia.Id,[{identity:accounts.editor.path,...READ_PERMISSIONS}]);
    });
    await checked('Logout removes cached private media metadata and private routes deny', async () => {
      await editorGoto(editor,'/media-library/'+privateMedia.Name);
      await editor.page.getByText('M0_PRIVATE_METADATA_'+id,{exact:true}).waitFor();
      await editor.page.getByRole('img',{name:privateMedia.DisplayName,exact:true}).waitFor();
      await until(()=>editor.page.getByRole('img',{name:privateMedia.DisplayName,exact:true}).evaluate(img=>img.naturalWidth>0).catch(()=>false),'Private binary image did not decode.');
      const previousDocument=await editor.page.evaluate(()=>performance.timeOrigin);
      await editor.page.getByRole('button',{name:/Logout/}).click();
      // Login can render before OIDC signoutRedirect and LoginButton's final reload.
      // Wait for a new, fully loaded frontend document before sending the direct-route GET.
      await editor.page.waitForFunction(({previousDocument,frontend})=>location.origin===frontend&&performance.timeOrigin!==previousDocument&&document.readyState==='complete',{previousDocument,frontend:FRONTEND},{timeout:60_000});
      report.logoutDocumentNavigationCompleted=true;
      await editor.page.waitForURL(url=>url.origin===FRONTEND,{timeout:60_000});
      await editor.page.getByRole('button',{name:/Login with/}).waitFor();
      assert.equal(await editor.page.getByText('M0_PRIVATE_METADATA_'+id,{exact:true}).count(),0);
      assert.equal(await editor.page.getByRole('img',{name:privateMedia.DisplayName,exact:true}).count(),0);
      const mark=editor.writes.length;
      await gotoStable(editor.page,FRONTEND+'/media-library/'+privateMedia.Name);await expectDeniedPage(editor.page);expectNoWrites(editor,mark);
      await editor.page.screenshot({path:path.join(output,'logout-private-denied.png')});
    });
    await checked('Timeline and media Delete UI remove isolated fixtures', async () => {
      await permissions(uiMedia.Id,[{identity:accounts.editor.path,...WRITE_PERMISSIONS}]);
      await login(editor,'editor',true);await editorGoto(editor,'/timelines/'+uiSlug);
      await editor.page.getByTitle('Delete Timeline',{exact:true}).click();
      await editor.page.waitForURL(FRONTEND+'/timelines');
      await assert.rejects(local.api(uiTimeline.Path,{account:accounts.admin}),error=>error.status===404);
      await editorGoto(editor,'/media-library');
      await editor.page.getByPlaceholder('Search titles, descriptions...').fill(id);
      await editor.page.getByRole('button',{name:'Search',exact:true}).click();
      const card=editor.page.getByRole('heading',{name:libraryTitle,exact:true}).locator('..');
      await card.getByRole('button',{name:'Delete',exact:true}).click();
      await editor.page.getByRole('heading',{name:libraryTitle,exact:true}).waitFor({state:'hidden'});
      await assert.rejects(local.api(uiMedia.Path,{account:accounts.admin}),error=>error.status===404);
    });
    report.browserMutationCounts={visitor:visitor.writes.length,reader:reader.writes.length,editor:editor.writes.length};
    report.browserMutationTransport='Native plans/apply POSTs; raw repository writes are forbidden.';
    report.rawRepositoryMutationCounts={visitor:visitor.rawMutations.length,reader:reader.rawMutations.length,editor:editor.rawMutations.length};
    for(const session of sessions)assert.equal(session.rawMutations.length,0,'A browser flow bypassed the native gateway.');
    report.passed=report.checks.every(check=>check.passed);
  } catch(error) {
    report.failure=redact(error.message);
    for(let index=0;index<contexts.length;index++) {
      const page=contexts[index].pages()[0];
      if(page&&!page.isClosed())await page.screenshot({path:path.join(output,`failure-${index}.png`)}).catch(()=>{});
    }
  } finally {
    if(browser)await browser.close();
    report.fixturePaths=[...new Set(created)];report.cleanup=[];
    for(const fixturePath of [...new Set(created)].sort((a,b)=>b.length-a.length)) {
      try {
        assert.ok(fixturePath.startsWith(ROOT+'/'),'Cleanup must stay in the canonical local project.');
        const target=await local.api(fixtureIds.get(fixturePath)||fixturePath,{account:accounts.admin,query:{$select:'Id,Name,DisplayName,Path',metadata:'no'}});
        const isolatedEntry=fixturePath.startsWith(TIMELINES+'/'+prefix+'-')&&fixturePath.slice(TIMELINES.length+1).split('/').length===2;
        assert.ok(target.Name.startsWith(prefix)||target.DisplayName?.includes(id)||isolatedEntry,'Cleanup may delete only this run UUID fixture.');
        await local.api(target.Id,{method:'DELETE',account:accounts.admin,query:{permanent:'true'}});
        report.cleanup.push({path:fixturePath,removed:true});
      } catch(error) {
        if(error.status===404)report.cleanup.push({path:fixturePath,alreadyRemoved:true});
        else {report.cleanup.push({path:fixturePath,error:redact(error.message)});report.passed=false;}
      }
    }
    report.sourceCountAfter=await sourceCount();
    if(report.sourceCountAfter!==report.sourceCountBefore){report.failure=report.failure||'Canonical content count changed after UUID fixture cleanup.';report.passed=false;}
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    fs.writeFileSync(path.join(local.ROOT,'browser-smoke.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.map(({name,passed})=>({name,passed})),report:path.join(output,'report.json'),...(report.failure?{failure:report.failure}:{})}));
  if(!report.passed)throw new Error(report.failure);
  return report;
}

module.exports={smoke};
if(require.main===module)smoke().catch(error=>{console.error(error.message);process.exitCode=1;});
