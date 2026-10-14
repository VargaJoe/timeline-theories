import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DomainError } from '../client/domain/content.mjs';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(directory, 'credential-encryption.key');
    if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = fs.readFileSync(keyPath);
    if (this.key.length !== 32) throw new DomainError('invalid_configuration', 'Invalid gateway encryption key.', 503);
    this.db = new DatabaseSync(path.join(directory, 'gateway.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, identity INTEGER NOT NULL, binding TEXT NOT NULL, scopes TEXT NOT NULL, credential TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, principal TEXT NOT NULL, request_hash TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (principal TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, plan_id TEXT NOT NULL, state TEXT NOT NULL, result TEXT, updated INTEGER NOT NULL, PRIMARY KEY(principal,key));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, principal TEXT NOT NULL, operation TEXT NOT NULL, outcome TEXT NOT NULL, targets TEXT NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS mutations (principal TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,payload TEXT NOT NULL,before_state TEXT NOT NULL,state TEXT NOT NULL,result TEXT,started INTEGER NOT NULL,PRIMARY KEY(principal,operation_id));');
  }
  encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
  }
  decrypt(value) {
    const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
  }
  issue({ id, identity, binding, scopes, credential, expires }) {
    const token = 'tta_' + randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO grants VALUES (?, ?, ?, ?, ?, ?, ?, 0)').run(id, hash(token), identity, binding, JSON.stringify(scopes), this.encrypt(credential), expires);
    return { id, token, scopes, expiresAt: new Date(expires).toISOString(), identity };
  }
  grant(token) {
    if (!/^tta_[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError('invalid_credential', 'Invalid credential.', 401);
    const row = this.db.prepare('SELECT * FROM grants WHERE token_hash=?').get(hash(token));
    if (!row || row.revoked || row.expires <= Date.now()) throw new DomainError('invalid_credential', 'Credential is expired, revoked or unavailable.', 401);
    return { ...row, scopes: JSON.parse(row.scopes), credential: this.decrypt(row.credential) };
  }
  active(id) {
    const row = this.db.prepare('SELECT revoked, expires FROM grants WHERE id=?').get(id);
    return !!row && !row.revoked && row.expires > Date.now();
  }
  revoke(id, identity) {
    return this.db.prepare('UPDATE grants SET revoked=1 WHERE id=? AND identity=?').run(id, identity).changes;
  }
  savePlan(plan) {
    this.db.prepare('INSERT INTO plans VALUES (?, ?, ?, ?, ?)').run(plan.id, plan.principal, plan.requestHash, JSON.stringify(plan), plan.expires);
    return plan;
  }
  plan(id, principal) {
    const row = this.db.prepare('SELECT * FROM plans WHERE id=? AND principal=?').get(id, principal);
    if (!row) throw new DomainError('plan_unavailable', 'Plan is unavailable for this credential.', 404);
    return JSON.parse(row.body);
  }
  recoveryPlan(id, identity) {
    const row=this.db.prepare('SELECT * FROM plans WHERE id=?').get(id);
    let owned=false;
    if(row?.principal.startsWith('grant:'))owned=this.db.prepare('SELECT identity FROM grants WHERE id=?').get(row.principal.slice(6))?.identity===identity;
    else owned=row?.principal.startsWith('session:'+identity+':')===true;
    if(!owned)throw new DomainError('plan_unavailable','Recovery plan is unavailable for this backend identity.',404);
    return JSON.parse(row.body);
  }
  reserve(principal, key, plan) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new DomainError('invalid_idempotency_key', 'Idempotency-Key must contain 8..128 safe characters.');
    this.db.prepare('INSERT OR IGNORE INTO operations VALUES (?, ?, ?, ?, ?, NULL, ?)').run(principal, key, plan.requestHash, plan.id, 'pending', Date.now());
    const row = this.db.prepare('SELECT * FROM operations WHERE principal=? AND key=?').get(principal, key);
    if (row.request_hash !== plan.requestHash || row.plan_id !== plan.id) throw new DomainError('idempotency_conflict', 'This key is already bound to a different plan/payload.', 409);
    return row.result ? JSON.parse(row.result) : null;
  }
  finish(principal, key, result) {
    this.db.prepare('UPDATE operations SET state=?, result=?, updated=? WHERE principal=? AND key=?').run(result.ok ? 'completed' : 'partial', JSON.stringify(result), Date.now(), principal, key);
  }
  audit(principal, operation, outcome, targets) {
    this.db.prepare('INSERT INTO audit(at,principal,operation,outcome,targets) VALUES (?,?,?,?,?)').run(Date.now(), principal, operation, outcome, JSON.stringify(targets));
  }
  close() { this.db.close(); }
}
export function constantEqual(a, b) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
