exports.handler = async function(event, context) {
  try {
    // Import fetch if not available (for older Node.js versions)
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    
    const { username, list } = event.queryStringParameters || {};
    if (!username || !list) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing username or list parameter' })
      };
    }

    // Load Trakt API key from SenseNet ECM with user authentication
    const { loadApiKey } = require('./sensenet');
    const repositoryUrl = process.env.VITE_SENSENET_REPO_URL;
    const projectRoot = process.env.VITE_PROJECT_ROOT_PATH || '/Root/Content';
    const traktKeyPath = process.env.VITE_TRAKT_KEY_PATH;
    const traktKeyFullPath = `${projectRoot}${traktKeyPath}`;
    // Extract Bearer token from Authorization header (if present)
    let bearerToken = null;
    const authHeader = event.headers && (event.headers.authorization || event.headers.Authorization);
    if (authHeader && authHeader.startsWith('Bearer ')) {
      bearerToken = authHeader.substring(7);
    }
    const apiKey = await loadApiKey(traktKeyFullPath, repositoryUrl, bearerToken);
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Trakt API key not found in SenseNet', details: { repositoryUrl, traktKeyFullPath, usedAuth: !!bearerToken } })
      };
    }

    const url = `https://api.trakt.tv/users/${username}/lists/${list}/items`;
    console.log('Fetching Trakt URL:', url);
    console.log('API Key present:', !!apiKey, 'Length:', apiKey.length);
    console.log('API Key first 10 chars:', apiKey.substring(0, 10));
    console.log('API Key last 10 chars:', apiKey.substring(apiKey.length - 10));
    
    // Test with a known public list first if we're getting 403s
    const isTestingPublicList = username === 'trakt' && list === 'trending-movies';
    const testUrl = isTestingPublicList ? url : 'https://api.trakt.tv/movies/trending?limit=1';
    
    const headers = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': apiKey
    };
    
    console.log('Request headers (trakt-api-key):', JSON.stringify(headers, null, 2));
    console.log('Testing URL:', testUrl);
    
    // First test API key works with a simple endpoint
    let testRes = await fetch(testUrl, { headers });
    console.log('Test endpoint response status:', testRes.status);
    
    if (testRes.ok && !isTestingPublicList) {
      console.log('API key works! Now trying original URL...');
    }
    
    // Try the original request
    let res = await fetch(url, { headers });
    
    console.log('Trakt API response status:', res.status);
    console.log('Response headers:', JSON.stringify([...res.headers.entries()], null, 2));
    
    if (!res.ok) {
      const errorText = await res.text();
      console.log('Trakt API error response:', errorText);
      
      // Include debug info in error response for troubleshooting
      const debugInfo = {
        apiKeyPresent: !!apiKey,
        apiKeyLength: apiKey.length,
        apiKeyStart: apiKey.substring(0, 10),
        apiKeyEnd: apiKey.substring(apiKey.length - 10),
        requestUrl: url,
        responseStatus: res.status,
        responseHeaders: [...res.headers.entries()]
      };
      
      return {
        statusCode: res.status,
        body: JSON.stringify({ 
          error: 'Failed to fetch from Trakt', 
          status: res.status,
          details: errorText,
          url: url,
          debug: debugInfo
        })
      };
    }
    const data = await res.json();
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({ error: 'Unexpected error', details: err && err.message ? err.message : String(err) })
    };
  }
};
