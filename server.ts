/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { ingestVideoFlow, queryKnowledgeFlow, getStoredStrategies } from './src/genkit-rag';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Configure CORS to prioritize and authorize access from https://boeki.vercel.app/
  const allowedOrigins = [
    'https://boeki.vercel.app',
    'https://boeki.vercel.app/',
    'http://localhost:3000',
    'http://localhost:5173'
  ];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      // Normalize trailing slash
      const normalizedOrigin = origin.replace(/\/$/, '');
      const isExplicitlyAllowed = allowedOrigins.some(o => o.replace(/\/$/, '') === normalizedOrigin);
      
      if (isExplicitlyAllowed || origin.endsWith('.vercel.app')) {
        callback(null, true);
      } else {
        // Fallback to true to allow in-container preview iframes to connect seamlessly
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
  }));

  // 1. Enable secure global JSON parsing with an increased limit to host high-resolution trading screenshots
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ limit: '20mb', extended: true }));

  // 2. Add API health and diagnostic checks
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      databaseId: 'linked'
    });
  });

  // 3. API RAG Ingestion route
  // Triggers Genkit ingestion flow to fetch transcript, chunk it, run text-embedding-005, and store in Firestore.
  app.post('/api/rag/ingest', async (req, res) => {
    try {
      const { youtubeUrl, userId } = req.body;
      if (!youtubeUrl) {
         res.status(400).json({ error: 'Missing mandatory "youtubeUrl" in requested JSON body.' });
         return;
      }

      console.log(`[HTTP Route] Received ingestion request for: ${youtubeUrl} (UserID: ${userId || 'anonymous'})`);
      const result = await ingestVideoFlow( { youtubeUrl, userId } );
      res.json(result);
    } catch (error: any) {
      console.error('[HTTP Route ERROR] Ingestion flow failed:', error);
      res.status(500).json({
        error: 'Video ingestion failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // 4. API RAG Queries route
  // Accepts query from user, performs vector search inside Firestore collection, synthesizes block using Gemini 3.1 Pro premium.
  app.post('/api/rag/query', async (req, res) => {
    try {
      const { query, message, maxChunks, history, image } = req.body;
      const targetQuery = query || message;
      if (!targetQuery || targetQuery.length < 1) {
         res.status(400).json({ error: 'Missing or empty "query" or "message" parameter.' });
         return;
      }

      console.log(`[HTTP Route] Received retrieval/query request: "${targetQuery}" (History size: ${history ? history.length : 0})`);
      const result = await queryKnowledgeFlow({
        query: targetQuery,
        maxStrategies: maxChunks ? Number(maxChunks) : 3,
        history,
        image
      });
      res.json(result);
    } catch (error: any) {
      console.error('[HTTP Route ERROR] query flow failed:', error);
      res.status(500).json({
        error: 'RAG retrieval or premium synthesis failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // 4b. GET /api/strategies
  // Returns list of all stored trading strategies currently ingested inside the collection.
  app.get('/api/strategies', async (req, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      const data = await getStoredStrategies(userId);
      res.json({ success: true, strategies: data });
    } catch (error: any) {
      console.error('[HTTP Route ERROR] fetching strategies failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // 5. Integrate Vite as developer asset server middleware or build asset server
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Dev Server] Mounting Vite dev compiler middleware...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('[Prod Server] Enabling static distribution paths...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 6. Start listening securely on the platform interface
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`  Hybrid Express Server Active!         `);
    console.log(`  Listening on http://0.0.0.0:${PORT}    `);
    console.log(`=========================================`);
  });
}

// Global exception handling
startServer().catch((err) => {
  console.error('[FATAL SERVER ERROR] Failed to bootstrap Express + Vite server:', err);
  process.exit(1);
});
