import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { readProfile } from './profile.mjs';

export default defineConfig(({ mode, command }) => {
  const profile = readProfile(mode, __dirname);
  const certDir = path.resolve(__dirname, '../deployment/.local/certificates');
  const key = path.join(certDir, 'localhost.key');
  const cert = path.join(certDir, 'localhost.crt');
  if (command === 'serve' && (!fs.existsSync(key) || !fs.existsSync(cert))) {
    throw new Error('Local HTTPS certificates are missing. Run the documented M0 runtime setup before starting the frontend.');
  }
  return {
    plugins: [react()],
    envDir: path.resolve(__dirname, 'profiles'),
    envPrefix: 'TIMELINE_PUBLIC_',
    define: { __TIMELINE_PROFILE__: JSON.stringify(profile) },
    server: { host: '127.0.0.1', port: 8080, strictPort: true,
      https: fs.existsSync(key) && fs.existsSync(cert) ? { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } : undefined },
  };
});
