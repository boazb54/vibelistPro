
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Removed 'define' block to prevent API key exposure in the browser bundle.
});