// Minimal SenseNet API key loader for Netlify functions (Node.js)
const fetch = globalThis.fetch || require('node-fetch');

async function loadApiKey(serviceKeyPath, repositoryUrl, bearerToken) {
  if (!serviceKeyPath || !repositoryUrl) return null;
  try {
    const pathParts = serviceKeyPath.split('/');
    const itemName = pathParts.pop(); // Get the last part (item name)
    const containerPath = pathParts.join('/'); // Get the container path
    const itemPath = `${containerPath}/('${itemName}')`;
    
    const url = `${repositoryUrl}/OData.svc${itemPath}?$select=ApiKey&metadata=no`;
    const headers = {};
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Failed to fetch API key: ${res.status}`);
    const data = await res.json();
    return data.d && data.d.ApiKey ? data.d.ApiKey : null;
  } catch (err) {
    console.error('[sensenet] Failed to load API key:', err);
    return null;
  }
}

module.exports = { loadApiKey };
