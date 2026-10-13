import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { readProfile, publicEnvDefines } from './profile.mjs';

export default defineConfig(({ mode, command }) => {
  const env = mode === 'm0-local' ? {} : loadEnv(mode, __dirname, 'VITE_');
  const profile = readProfile(mode, __dirname, env);
  const certDir = path.resolve(__dirname, '../deployment/.local/certificates');
  const key = path.join(certDir, 'localhost.key');
  const cert = path.join(certDir, 'localhost.crt');
  if (command === 'serve' && (!fs.existsSync(key) || !fs.existsSync(cert))) {
    throw new Error('Local HTTPS certificates are missing. Run the documented M0 runtime setup before starting the frontend.');
  }
  return {
    plugins: [react()],
    envDir: mode === 'm0-local' ? path.resolve(__dirname, 'profiles') : __dirname,
    envPrefix: [],
    define: { __TIMELINE_PROFILE__: JSON.stringify(profile), ...publicEnvDefines(env) },
    server: { host: '127.0.0.1', port: 8080, strictPort: true,
      https: fs.existsSync(key) && fs.existsSync(cert) ? { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } : undefined },
  };
});
