import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Casting process to any to avoid TS error if Node types are not properly picked up
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      // API Key is now handled server-side via proxy, no longer needed client-side in build.
      // Keeping this define block minimal or removing it entirely if no other client-side env vars are needed.
    },
  };
})