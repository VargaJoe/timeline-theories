// Minimal SenseNet API key loader for Netlify functions (Node.js)
const fetch = globalThis.fetch || require('node-fetch');

async function loadApiKey(serviceKeyPath, repositoryUrl) {
  if (!serviceKeyPath || !repositoryUrl) return null;
  try {
    const url = `${repositoryUrl}/OData.svc${serviceKeyPath}?$select=ApiKey&metadata=none`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch API key: ${res.status}`);
    const data = await res.json();
    return data.d && data.d.ApiKey ? data.d.ApiKey : null;
  } catch (err) {
    console.error('[sensenet] Failed to load API key:', err);
    return null;
  }
}

module.exports = { loadApiKey };
