exports.handler = async function(event) {
  try {
    const {username,list}=event.queryStringParameters||{};
    if(!username||!list) return {statusCode:400,body:JSON.stringify({error:'Missing username or list'})};
    const apiKey=process.env.TRAKT_API_KEY;
    if(!apiKey) return {statusCode:503,body:JSON.stringify({error:'Trakt provider is not configured'})};
    const url='https://api.trakt.tv/users/'+encodeURIComponent(username)+'/lists/'+encodeURIComponent(list)+'/items';
    const response=await fetch(url,{headers:{'trakt-api-version':'2','trakt-api-key':apiKey}});
    if(!response.ok) return {statusCode:response.status,body:JSON.stringify({error:'Trakt request failed',status:response.status})};
    return {statusCode:200,headers:{'Content-Type':'application/json'},body:JSON.stringify(await response.json())};
  } catch {return {statusCode:502,body:JSON.stringify({error:'Trakt request failed'})};}
};
