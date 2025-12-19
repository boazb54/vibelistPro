
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      // Ensure API_KEY is never undefined to prevent syntax errors in the bundled code
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY || env.API_KEY || ""),
    },
    build: {
      // Ensure the build target supports modern JS features
      target: 'esnext'
    }
  };
})
