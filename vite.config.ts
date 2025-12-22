import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Casting process to any to avoid TS error if Node types are not properly picked up
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      // Critical fix: Check process.env.API_KEY (System/Vercel) first, then fallback to env file.
      // This ensures the key is passed to the browser build.
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY || env.API_KEY),
    },
  };
})