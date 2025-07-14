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

    // Debug: Check if API key exists
    const apiKey = process.env.TRAKT_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'TRAKT_API_KEY environment variable not set' })
      };
    }

    const url = `https://api.trakt.tv/users/${username}/lists/${list}/items`;
    console.log('Fetching Trakt URL:', url);
    console.log('API Key present:', !!apiKey, 'Length:', apiKey.length);
    console.log('API Key first 10 chars:', apiKey.substring(0, 10));
    console.log('API Key last 10 chars:', apiKey.substring(apiKey.length - 10));
    
    const headers = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': apiKey
    };
    console.log('Request headers:', JSON.stringify(headers, null, 2));
    
    const res = await fetch(url, { headers });
    
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
