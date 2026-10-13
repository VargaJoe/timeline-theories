/** Copy caller-owned request data before any permission/readiness await. */
export function snapshotRequestInit(init = {}) {
  let body = init.body;
  if (body instanceof FormData) {
    body = new FormData();
    init.body.forEach((value,key) => body.append(key,value));
  }
  if (body && typeof body !== 'string' && !(body instanceof FormData)) throw new Error('Unsupported checked request body');
  return Object.freeze({...init,headers:new Headers(init.headers),body,method:(init.method || 'GET').toUpperCase()});
}
/** Fail closed on unknown permissions. Decisions never outlive the identity/repository revision. */
export function createOperationGuard({ probe, childTypes, writable, identity }) {
  let revision = 0;
  const listeners = new Set();
  const invalidate = () => { revision++; for (const listener of listeners) listener(); };
  const assert = async operations => {
    const start = revision;
    const subject = identity();
    for (const operation of operations) {
      if (!operation.target || !['read','create','update','delete','upload'].includes(operation.action)) throw new Error('Unknown operation target');
      if (operation.action !== 'read' && !writable()) throw new Error('This repository is read only');
      const permissions = { read: ['Open'], create: ['AddNew'], update: ['Save'], delete: ['Delete'], upload: ['Save'] }[operation.action];
      if (await probe(operation.target, permissions) !== true) throw new Error('Permission denied or unavailable');
      if (operation.action === 'create') {
        if (!operation.contentType || !(await childTypes(operation.target)).includes(operation.contentType)) throw new Error('Content type is not permitted on this target');
      }
      if (start !== revision || subject !== identity()) throw new Error('Identity or permissions changed; retry the operation');
    }
  };
  const context = () => { const start=revision, subject=identity(); return () => { if(start!==revision || subject!==identity()) throw new Error('Operation context changed; start again'); }; };
  return { assert, context, can: async operations => { try { await assert(operations); return true; } catch { return false; } }, invalidate,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
}

/** The app sees this facade; each mutation checks its concrete target before dispatch. */
export function guardRepository(raw, guard) {
  return new Proxy(raw, {
    get(object, key) {
      if (key === 'post') return async options => { await guard.assert([{ target: options.parentPath, action: 'create', contentType: options.contentType }]); return object.post(options); };
      if (key === 'patch') return async options => { await guard.assert([{ target: options.idOrPath, action: 'update' }]); return object.patch(options); };
      if (key === 'delete') return async options => { await guard.assert([].concat(options.idOrPath).map(target => ({target,action:'delete'}))); return object.delete(options); };
      if (key === 'load') return async options => { await guard.assert([{target:options.idOrPath,action:'read'}]); return object.load(options); };
      if (key === 'loadCollection') return async options => { await guard.assert([{target:options.path,action:'read'}]); return object.loadCollection(options); };
      if (key === 'fetch') return async (url, init) => {
        if (typeof url !== 'string') throw new Error('Request objects are not supported by the checked repository');
        const snapshot = snapshotRequestInit(init);
        if (!['GET','HEAD'].includes(snapshot.method)) throw new Error('Use a checked domain operation for writes');
        return object.fetch(url, snapshot);
      };
      if (key === 'executeAction') return async options => {
        if ((options.method || 'GET').toUpperCase() !== 'GET') throw new Error('Unchecked action writes are disabled');
        return object.executeAction(options);
      };
      if (['put','upload','move','copy'].includes(key)) return () => { throw new Error('Unchecked repository writes are disabled'); };
      const value = Reflect.get(object,key);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
}
