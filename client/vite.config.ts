import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    https: {
      pfx: fs.readFileSync(path.resolve(__dirname, '../deployment/temp/certificates/snapp.pfx')),
      passphrase: 'SuP3rS3CuR3P4sSw0Rd'
    }
  },
})
