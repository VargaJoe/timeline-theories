import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const certPath = path.resolve(__dirname, '../deployment/temp/certificates/snapp.pfx')
const httpsConfig = fs.existsSync(certPath) ? {
  pfx: fs.readFileSync(certPath),
  passphrase: 'SuP3rS3CuR3P4sSw0Rd'
} : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    https: httpsConfig
  },
})
