import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from '../client/node_modules/vite/dist/node/index.js';
import { readProfile, publicEnvDefines } from '../client/profile.mjs';

const env = {VITE_SENSENET_REPO_URL:'https://repository.example',VITE_OIDC_AUTHORITY:'https://auth.example',VITE_OIDC_CLIENT_ID:'public-client',VITE_PROJECT_ROOT_PATH:'/Root/Content/custom'};
test('ordinary development and production honor configured remote repository and auth',()=>{
  for (const mode of ['development','production']) {
    const profile=readProfile(mode,'.',env);
    assert.equal(profile.repositoryUrl,env.VITE_SENSENET_REPO_URL);
    assert.equal(profile.authority,env.VITE_OIDC_AUTHORITY);
    assert.equal(profile.clientId,env.VITE_OIDC_CLIENT_ID);
    assert.equal(profile.projectRoot,env.VITE_PROJECT_ROOT_PATH);
    assert.equal(profile.writable,true);
    assert.equal(profile.authType,'auto');
  }
});
test('read only is explicit and never changes configured target',()=>{
  for (const profile of [readProfile('production-readonly','.',env),readProfile('production','.',{...env,VITE_READ_ONLY:'true'})]) {
    assert.equal(profile.writable,false);
    assert.equal(profile.repositoryUrl,env.VITE_SENSENET_REPO_URL);
  }
  assert.throws(()=>readProfile('production','.',{...env,VITE_READ_ONLY:'yes'}));
  assert.throws(()=>readProfile('production','.',{}));
});
test('Vite env files use standard mode/local precedence; hosting process env wins',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timeline-env-'));
  t.after(()=>{if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(dir,{recursive:true});});
  fs.writeFileSync(path.join(dir,'.env'),Object.entries(env).map(([key,value])=>`${key}=${value}`).join('\n'));
  fs.writeFileSync(path.join(dir,'.env.local'),'VITE_SENSENET_REPO_URL=https://local-choice.example');
  fs.writeFileSync(path.join(dir,'.env.production'),'VITE_SENSENET_REPO_URL=https://mode-choice.example');
  fs.writeFileSync(path.join(dir,'.env.production.local'),'VITE_SENSENET_REPO_URL=https://mode-local-choice.example');
  const old=process.env.VITE_SENSENET_REPO_URL;
  t.after(()=>{if(old===undefined)delete process.env.VITE_SENSENET_REPO_URL;else process.env.VITE_SENSENET_REPO_URL=old;});
  delete process.env.VITE_SENSENET_REPO_URL;
  assert.equal(readProfile('development',dir,loadEnv('development',dir,'VITE_')).repositoryUrl,'https://local-choice.example');
  assert.equal(readProfile('production',dir,loadEnv('production',dir,'VITE_')).repositoryUrl,'https://mode-local-choice.example');
  process.env.VITE_SENSENET_REPO_URL='https://hosting-choice.example';
  assert.equal(readProfile('production',dir,loadEnv('production',dir,'VITE_')).repositoryUrl,'https://hosting-choice.example');
});
test('only explicit public fields enter browser defines; key/token/password settings are excluded',()=>{
  const defines=publicEnvDefines({...env,VITE_SENSENET_API_KEY:'private-key',VITE_TRAKT_API_KEY:'private-trakt',VITE_PASSWORD:'private-password',VITE_CUSTOM_TOKEN:'private-token'});
  assert.equal(defines['import.meta.env.VITE_SENSENET_REPO_URL'],JSON.stringify(env.VITE_SENSENET_REPO_URL));
  assert.ok(!JSON.stringify(defines).includes('private-'));
});
