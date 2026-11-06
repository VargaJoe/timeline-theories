/** Caller-bound UI hints only. Actual writes still use the fresh operation guard. */
export function createDisplayPermissions({ identity, writable, load, ready, now = Date.now, ttlMs = Infinity, concurrency = 4 }) {
  let subject = identity(), revision = 0, active = 0;
  const records = new Map(), flights = new Map(), queue = [];
  const key = target => typeof target === 'number' && Number.isSafeInteger(target) && target > 0 || typeof target === 'string' && /^[1-9][0-9]*$/.test(target) && Number.isSafeInteger(Number(target))
    ? 'id:' + Number(target) : typeof target === 'string' && target.toLowerCase().startsWith('/root/') && !/\.\.|[\\?#\x00-\x1f]/.test(target) ? 'path:' + target.toLowerCase() : null;
  const invalidate = () => { revision++; subject = identity(); records.clear(); flights.clear(); };
  const context = () => { if (subject !== identity()) invalidate(); return { subject, revision }; };
  const current = start => start.subject === identity() && start.subject === subject && start.revision === revision;
  function actions(value) {
    const rows = Array.isArray(value) ? value : value && Array.isArray(value.results) ? value.results : null;
    if (!rows) return null;
    const result = new Map();
    for (const row of rows) if (row && typeof row.Name === 'string') result.set(row.Name, row.Forbidden === false && result.get(row.Name) !== false);
    return result;
  }
  function store(content, aliases, descriptorLoaded) {
    if (!content || !Number.isSafeInteger(content.Id) || content.Id < 1 || !key(content.Path)?.startsWith('path:')) return null;
    const types = Array.isArray(content.EffectiveAllowedChildTypes) ? content.EffectiveAllowedChildTypes : content.EffectiveAllowedChildTypes?.results;
    const record = { id: content.Id, path: content.Path, actions: actions(content.Actions), childTypes: Array.isArray(types) ? types.filter(row => row && typeof row.Name === 'string').map(row => row.Name) : null, fetchedAt: now(), descriptorLoaded };
    for (const alias of [content.Id, content.Path, ...aliases]) {
      const targetKey = key(alias);
      if (targetKey === key(content.Id) || targetKey === key(content.Path)) records.set(targetKey, record);
    }
    while (records.size > 2048) records.delete(records.keys().next().value);
    return record;
  }
  function remember(content, aliases = []) { context(); return store(content, aliases, false); }
  function drain() {
    while (active < concurrency && queue.length) {
      const task = queue.shift(); active++;
      Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { active--; drain(); });
    }
  }
  function schedule(run) { return new Promise((resolve, reject) => { queue.push({ run, resolve, reject }); drain(); }); }
  async function descriptor(target, write, creating, since, start) {
    const targetKey = key(target); if (!targetKey || !current(start)) return null;
    const saved = records.get(targetKey);
    if (saved && saved.fetchedAt >= since && now() - saved.fetchedAt < ttlMs && (!write || saved.descriptorLoaded || saved.actions !== null && (!creating || saved.childTypes !== null && saved.actions.has('Add')))) return saved;
    if (flights.has(targetKey)) return flights.get(targetKey);
    const promise = schedule(async () => {
      if (!current(start)) return null;
      let record = null;
      try {
        const content = await load(target);
        if (!current(start)) return null;
        if (key(content?.Id) === targetKey || key(content?.Path) === targetKey) record = store(content, [target], true);
      } catch { /* Unknown or inaccessible metadata is never permission. */ }
      if (!current(start)) return null;
      if (!record) { record = { actions: null, fetchedAt: now(), descriptorLoaded: true, missing: true }; records.set(targetKey, record); }
      return record;
    });
    flights.set(targetKey, promise);
    try { return await promise; } finally { if (flights.get(targetKey) === promise) flights.delete(targetKey); }
  }
  async function can(operations, { refreshSince = -Infinity } = {}) {
    const start = context();
    if (!Array.isArray(operations) || !operations.length || operations.some(op => !op || !key(op.target) || !['read', 'update', 'delete', 'upload', 'create'].includes(op.action) || op.action === 'create' && (typeof op.contentType !== 'string' || !op.contentType))) return false;
    const writing = operations.filter(op => op.action !== 'read');
    if (writing.length && !writable()) return false;
    try {
      const values = await Promise.all(operations.map(op => descriptor(op.target, op.action !== 'read', op.action === 'create', refreshSince, start)));
      if (!current(start)) return false;
      if (!values.every((value, index) => {
        const op = operations[index];
        return value && !value.missing && (op.action === 'read' || value.actions?.get(op.action === 'delete' ? 'Delete' : op.action === 'create' ? 'Add' : 'Edit') === true && (op.action !== 'create' || value.childTypes?.includes(op.contentType)));
      })) return false;
      if (writing.length && (await ready(writing[0].target, writing[0].action === 'create')) !== true) return false;
      return current(start) && (!writing.length || writable());
    } catch { return false; }
  }
  return { remember, can, invalidate };
}
