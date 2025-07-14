exports.handler = async function(event, context) {
  try {
    if (typeof fetch !== 'function') {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'fetch is not available in this environment' })
      };
    }
    const { username, list } = event.queryStringParameters;
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
    
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': apiKey
      }
    });
    
    console.log('Trakt API response status:', res.status);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.log('Trakt API error response:', errorText);
      return {
        statusCode: res.status,
        body: JSON.stringify({ 
          error: 'Failed to fetch from Trakt', 
          status: res.status,
          details: errorText,
          url: url
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
