/** One compound read, including its body, must not leave the UI pending forever. */
export async function fetchPermissionRows(fetch, url, timeoutMs = 15_000) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Permission content request timed out');
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(url, { method: 'GET', signal: controller.signal }, false);
      if (!response.ok) throw Object.assign(new Error('Permission content is unavailable'), {
        permissionUnavailable: ![401, 403, 404].includes(response.status),
      });
      const value = await response.json();
      if (!Array.isArray(value?.d?.results)) throw new Error('Permission content is invalid');
      return value.d.results;
    })()]);
  } finally {
    clearTimeout(timer);
  }
}
