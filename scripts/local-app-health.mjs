import fs from 'node:fs';
import https from 'node:https';

// Exercise the real Function/config as well as the public HTTPS gateway.
const request = https.get('https://localhost:8080/api/v1/capabilities', {
  ca: fs.readFileSync(new URL('../deployment/.local/certificates/localhost.pem', import.meta.url)),
}, response => {
  let body = '';
  response.setEncoding('utf8');
  response.on('data', chunk => { body += chunk; if (body.length > 65536) request.destroy(new Error('health response too large')); });
  response.on('end', () => {
    try {
      const value = JSON.parse(body);
      if (response.statusCode !== 200 || value.version !== '1' || value.basePath !== '/api/v1' || !Array.isArray(value.operations)) process.exitCode = 1;
    } catch { process.exitCode = 1; }
  });
});
request.setTimeout(6000, () => request.destroy(new Error('health timeout')));
request.on('error', () => { process.exitCode = 1; });
