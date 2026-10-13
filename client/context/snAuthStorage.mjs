const tokenKeys = new Set(['sn-auth-access-token', 'sn-auth-refresh-token', 'sn-auth-user-details']);
const bindingKey = Symbol.for('timeline.sn-auth-storage-binding');

/** The SDK hardcodes three localStorage keys. Scope its native storage methods
 * in this window, so another profile's tab (including late refreshes/callbacks)
 * cannot supply credentials to this profile. Other storage keys and sessionStorage
 * retain their native behavior. A profile change requires a full page load.
 */
export function bindSnAuthStorage(storage, profile) {
  const owner = JSON.stringify([profile.repositoryUrl, profile.authority, profile.clientId]);
  const prototype = Object.getPrototypeOf(storage);
  const existing = prototype[bindingKey];
  if (existing) {
    if (existing.storage !== storage || existing.owner !== owner) throw new Error('Authentication profile changed; reload the page.');
    return;
  }
  const prefix = 'timeline-sn-auth:' + encodeURIComponent(owner) + ':';
  const methods = Object.fromEntries(['getItem', 'setItem', 'removeItem'].map(name => [name, prototype[name]]));
  if (Object.values(methods).some(method => typeof method !== 'function')) throw new Error('Native authentication storage is unavailable.');
  // Unattributed legacy credentials are never migrated or sent to any profile.
  for (const key of tokenKeys) methods.removeItem.call(storage, key);
  methods.removeItem.call(storage, 'timeline-sn-auth-profile');
  const descriptors = Object.fromEntries(Object.entries(methods).map(([name, native]) => [name, {
    configurable: true, writable: true, value: function (key, ...args) {
      const actualKey = this === storage && tokenKeys.has(String(key)) ? prefix + String(key) : key;
      return native.call(this, actualKey, ...args);
    },
  }]));
  Object.defineProperties(prototype, { ...descriptors, [bindingKey]: { value: { owner, storage } } });
}
