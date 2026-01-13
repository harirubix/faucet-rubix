import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'

dotenv.config()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.FAUCET_UI_PORT, 10) || 4000,
    host: process.env.FAUCET_UI_HOST,
    allowedHosts: [process.env.FAUCET_UI_ALLOWED_HOST],
    proxy: {
      "/increment": {
        target: process.env.FAUCET_BACKEND_ADDRESS,
        changeOrigin: true,
        secure: false
      }
    }
  }
})
