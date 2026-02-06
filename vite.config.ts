
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Custom plugin to handle API routes in dev mode
const apiRoutesPlugin = {
  name: 'api-routes',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // Parse JSON body manually if Content-Type is application/json
      if (req.method === 'POST' && req.headers['content-type']?.includes('application/json')) {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          try {
            req.body = body ? JSON.parse(body) : {};
            await handleApiRoute(req, res, next);
          } catch (parseError) {
            console.error('[API] JSON parse error:', parseError);
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
          }
        });
      } else {
        next();
      }
    });

    async function handleApiRoute(req, res, next) {
      if (!req.url?.startsWith('/api/')) {
        return next();
      }

      try {
        const apiPath = `.${req.url}`;
        console.log(`[API] Loading handler from: ${apiPath}`);
        
        // Wrap the raw Node response with Express-like methods
        const wrappedRes = wrapNodeResponse(res);
        
        // Import the handler dynamically
        const handler = await import(apiPath);
        console.log(`[API] Executing ${req.url} handler`);
        
        // Call the handler with wrapped response
        await handler.default(req, wrappedRes);
      } catch (error) {
        console.error(`[API] Error executing ${req.url}:`, error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ 
            error: 'Internal Server Error', 
            details: error.message 
          }));
        }
      }
    }

    // Helper to wrap Node.js response with Express-like methods
    function wrapNodeResponse(res) {
      res.status = function(code) {
        this.statusCode = code;
        return this;
      };
      res.json = function(data) {
        this.setHeader('Content-Type', 'application/json');
        this.end(JSON.stringify(data));
        return this;
      };
      return res;
    }
  }
};

export default defineConfig({
  plugins: [react(), apiRoutesPlugin],
  server: {
    allowedHosts: [
      'unprorogued-nonarmigerous-tammie.ngrok-free.dev',
      'localhost',
      '127.0.0.1'
    ]
  }
  // Removed 'define' block to prevent API key exposure in the browser bundle.
});