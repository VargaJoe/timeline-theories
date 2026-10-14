import { randomUUID } from 'node:crypto';
import { StockRepository } from './stock-repository.mjs';
import { MutationJournal } from './journal.mjs';
import { DomainError, assertObject } from '../domain/content.mjs';
import { hash } from './store.mjs';
export const SCOPES = ['content:read','timelines:write','media:write','entries:write','covers:write','metadata:write','providers:read','exchange:read','exchange:write'];
export const binding = config => hash({ repository: config.repositoryUrl, authority: config.authority, project: config.projectRoot });
export function assertBinding(req, config) {
  if (req.headers['x-timeline-repository'] !== config.repositoryUrl || req.headers['x-timeline-project'] !== config.projectRoot || req.headers['x-timeline-authority'] !== config.authority) throw new DomainError('target_binding_mismatch','Repository, authority and project binding headers must match this gateway.',403);
}
export async function authenticate(req, config, store, { session = false, anonymous = false } = {}) {
  assertBinding(req,config);
  const authorization = req.headers.authorization;
  if (!authorization && anonymous) return makeContext(null,null,['content:read'],config,store);
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw new DomainError('invalid_credential','A bearer credential is required.',401);
  const token = authorization.slice(7);
  if (token.startsWith('tta_')) {
    if (session) throw new DomainError('session_required','Use the authenticated owner session to issue a new grant.',403);
    const grant = await store.grant(token);
    if (grant.binding !== binding(config)) throw new DomainError('target_binding_mismatch','Credential belongs to another repository/auth/project.',403);
    return makeContext(grant.credential,grant,grant.scopes,config,store);
  }
  // The repository, rather than an unverified JWT payload, authenticates the
  // supplied user credential. There is no stored administrator fallback.
  const mode = req.headers['x-timeline-backend-auth'] === 'ApiKey' ? 'ApiKey' : 'Bearer';
  if (!session && req.headers.origin !== config.frontendOrigin && req.headers['x-timeline-client-origin']!==config.frontendOrigin) throw new DomainError('scoped_credential_required','Native clients must use an issued scoped credential.',401);
  return makeContext({mode,value:token},null,SCOPES,config,store);
}
async function makeContext(credential, grant, scopes, config, store) {
  const repo = new StockRepository(config,credential), identity = await repo.identity();
  if (grant && identity.Id !== grant.identity) throw new DomainError('identity_mismatch','Backend credential identity changed.',401);
  const principal = grant ? 'grant:' + grant.id : credential ? 'session:' + identity.Id + ':' + hash(credential.value) : 'visitor';
  const context = { repo, journal:new MutationJournal(store,principal,repo), credential, grant, scopes, identity, principal, check: async () => {
    if (grant && !await store.active(grant.id)) throw new DomainError('credential_revoked','Credential expired or was revoked before dispatch.',401);
    const current = await repo.identity();
    if (current.Id !== identity.Id) throw new DomainError('identity_mismatch','Backend identity changed before dispatch.',401);
    if (grant && !await store.active(grant.id)) throw new DomainError('credential_revoked','Credential expired or was revoked during backend identity verification.',401);
  } };
  repo.beforeWrite=context.check;
  return context;
}
export async function issueGrant(context, input, config, store) {
  assertObject(input);
  if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.some(s=>!SCOPES.includes(s)) || new Set(input.scopes).size !== input.scopes.length) throw new DomainError('invalid_scope','Choose explicit supported application scopes.');
  if (Object.keys(input).some(k=>!['scopes','expiresInSeconds'].includes(k))) throw new DomainError('invalid_input','Unknown grant property.');
  const expiresInSeconds = input.expiresInSeconds ?? 86400;
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 30 * 86400) throw new DomainError('invalid_expiry','Grant lifetime must be 60 seconds to 30 days.');
  await context.check();
  if (!context.credential) throw new DomainError('session_required','An authenticated backend user is required.',401);
  const result = await store.issue({id:randomUUID(),identity:context.identity.Id,binding:binding(config),scopes:input.scopes,credential:context.credential,expires:Date.now()+expiresInSeconds*1000});
  await store.audit(context.principal,'grant','issued',[]); return result;
}
