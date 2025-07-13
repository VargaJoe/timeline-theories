exports.handler = async function(event, context) {
  const { username, list } = event.queryStringParameters;
  if (!username || !list) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing username or list parameter' })
    };
  }
  const url = `https://api.trakt.tv/users/${username}/lists/${list}/items`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': process.env.TRAKT_API_KEY
    }
  });
  if (!res.ok) {
    return {
      statusCode: res.status,
      body: JSON.stringify({ error: 'Failed to fetch from Trakt', status: res.status })
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
};
