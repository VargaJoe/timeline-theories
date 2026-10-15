import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from './m1-client.mjs';
import { invokeBackground } from '../client/api/jobs.mjs';
import { loadEnv } from '../client/node_modules/vite/dist/node/index.js';
import { readProfile } from '../client/profile.mjs';

// Fixed localhost app + the browser's public profile only. Vite's normal env
// precedence is used; arbitrary env values never enter requests or output.
// No MCP credential reader, repository write or authenticated job exists.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app='https://localhost:8080';
let phase='discovery';
export async function smoke() {
  const caFile=path.join(root,'deployment/.local/certificates/localhost.pem');
  const clientRoot=path.join(root,'client'),profile=readProfile('production-readonly',clientRoot,loadEnv('production-readonly',clientRoot,'VITE_'));
  const {repositoryUrl:repository,authority,projectRoot:project}=profile;
  const client=createClient({baseUrl:app+'/api/v1',repository,authority,project,caFile});
  const capabilities=await client.verify();
  assert.equal(capabilities.readOnly,true,'Run the configured app with --readonly, without --local.');
  assert.equal(capabilities.runtime,'Netlify Functions in the Timeline app');
  phase='storage';
  const response=await client.rawRequest('/__verification/storage',{method:'POST',body:{}});
  assert.equal(response.status,200);const proof=JSON.parse(response.body.toString());
  assert.equal(proof.senseNetRequests,0);assert.equal(proof.repositoryWrites,0);
  assert.equal(proof.storageSelftest?.passed,true);assert.equal(proof.storageSelftest.checks.firstWriteWinners,1);
  for(const name of ['strongInitialRead','nonmatchingCasRejected','currentCasSucceeded','staleCasRejected','strongFinalRead','ownedCleanupVerified'])assert.equal(proof.storageSelftest.checks[name],true);
  // This proves the actual same-app HTTPS acknowledgement transport. Missing
  // credentials reject the synthetic job before any SenseNet identity request;
  // it does not claim to execute an authenticated content-management job.
  const headers=new Headers({'Content-Type':'application/json','X-Timeline-Repository':repository,'X-Timeline-Authority':authority,'X-Timeline-Project':project});
  assert.equal(headers.has('authorization'),false);
  phase='background-https';
  await invokeBackground(app+'/.netlify/functions/native-api-background',headers,Buffer.from(JSON.stringify({jobId:randomUUID()})),{frontendOrigin:app,local:false,devRuntime:true,appCa:fs.readFileSync(caFile)});
  const result={passed:true,app,repository,authority,project,readOnly:true,checks:3,privateAppStorage:true,backgroundHttpsAcknowledged:true,credentialsSent:false,authenticatedJobsRun:0,repositoryWrites:0};
  fs.writeFileSync(path.join(root,'deployment/.local/m1-configured-dev-report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)smoke().catch(error=>{console.error(JSON.stringify({passed:false,phase,code:error.code||'configured_dev_verification_failed',status:error.status??null,credentialsSent:false}));process.exitCode=1;});
