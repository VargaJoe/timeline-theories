import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DomainError } from '../client/domain/content.mjs';
import { hash } from './store.mjs';

/** Shared durable application writer boundary. SQLite's actual database lock,
 * not the in-process scheduling queue, coordinates independent API processes.
 * Every Timeline UI/agent write must use this gateway. Direct repository admin
 * edits are outside this serialization contract and are never claimed atomic. */
export class Coordinator {
  constructor(config) {
    fs.mkdirSync(config.dataDir,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(config.dataDir,'coordination.sqlite'));
    this.db.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);');
    const value=hash({repository:config.repositoryUrl,authority:config.authority,project:config.projectRoot});
    this.db.prepare('INSERT OR IGNORE INTO binding VALUES (1,?)').run(value);
    if(this.db.prepare('SELECT value FROM binding WHERE id=1').get().value!==value)throw new DomainError('coordinator_binding_mismatch','This persistent coordinator belongs to a different repository/auth/project.',503);
    this.queue=Promise.resolve();
  }
  run(action) {
    const result=this.queue.then(async()=>{
      const deadline=Date.now()+60000;
      for(;;){try{this.db.exec('BEGIN IMMEDIATE');break;}catch(error){if(!String(error.message).includes('locked')&&!String(error.message).includes('busy'))throw error;if(Date.now()>deadline)throw new DomainError('coordinator_busy','The shared application writer is busy; retry the same saved plan/key.',503);await new Promise(resolve=>setTimeout(resolve,25));}}
      try{const value=await action();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}
    });
    // Avoid blocking this process's event loop while another request awaits
    // repository I/O. Independent processes still contend on BEGIN IMMEDIATE.
    this.queue=result.catch(()=>{});return result;
  }
  close(){this.db.close();}
}
