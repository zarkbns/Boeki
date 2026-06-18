/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { ingestVideoFlow, queryKnowledgeFlow, getStoredStrategies } from './src/genkit-rag';
import { generateTextContent } from './src/gemini-client';

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

// 2. Add environment sanity check middleware for Serverless Vercel runs
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const isGeminiKeyConfigured = !!geminiKey && 
      geminiKey.trim() !== '' && 
      !geminiKey.toUpperCase().includes('PLACEHOLDER') &&
      !geminiKey.toUpperCase().startsWith('YOUR_');

    console.log(`[Vercel Serverless Diagnostic] Request to "${req.path}"`);
    console.log(`[Vercel Serverless Diagnostic] GEMINI_API_KEY Configured: ${isGeminiKeyConfigured ? 'YES (Verified)' : 'NO (Missing or Placeholder)'}`);
    
    if (geminiKey) {
      const masked = geminiKey.length > 8 
        ? `${geminiKey.substring(0, 4)}...${geminiKey.substring(geminiKey.length - 4)}` 
        : '***';
      console.log(`[Vercel Serverless Diagnostic] GEMINI_API_KEY value: [${masked}] (length: ${geminiKey.length})`);
    }

    if (['/api/rag/query', '/api/rag/ingest', '/api/strategies/compare'].includes(req.path) && !isGeminiKeyConfigured) {
      console.error('[CRITICAL CONFIG ERROR] Attempted execution of AI/RAG route without valid GEMINI_API_KEY configured!');
      res.status(500).json({
        success: false,
        error: 'Backend API key configuration error',
        details: 'GEMINI_API_KEY is missing or contains placeholder values. Please declare it in your Vercel Project Environment variables.'
      });
      return;
    }
  }
  next();
});

// 3. Add API health and diagnostic checks
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    databaseId: 'linked'
  });
});

// 2b. Add API dynamic Open Graph (OG) image generation route
// Serves a 1200x630 pristine, vector-sharp dynamic SVG matching the terminal aesthetic
app.get('/api/og', (req, res) => {
  const titleParam = (req.query.title as string) || 'Trading Intelligence';
  const subtitleParam = (req.query.subtitle as string) || 'QUANTITATIVE ANALYSIS SUITE';
  
  // Clean parameter helper to avoid basic injection or break templates
  const escapeXml = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const escapedTitle = escapeXml(titleParam);
  const escapedSubtitle = escapeXml(subtitleParam);

  // Divide title into up to 3 lines nicely
  const words = escapedTitle.split(/\s+/);
  const titleLines: string[] = [];
  let currentLine = '';
  const maxLineLength = 28;

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxLineLength) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) titleLines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) titleLines.push(currentLine);
  const displayLines = titleLines.slice(0, 3);

  // Fallback to avoid empty line positions
  if (displayLines.length === 0) {
    displayLines.push('Market Analysis');
  }

  // Construct SVG Template
  // Set explicit height, width, dark aesthetic, Pure Black background, custom geometric tail motif
  const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&amp;display=swap');
      .term-text {
        font-family: 'JetBrains Mono', Courier, monospace;
      }
      .glow-red { fill: #FF5F56; }
      .glow-yellow { fill: #FFBD2E; }
      .glow-green { fill: #27C93F; }
    </style>
    
    <!-- Base Background: Pure Black -->
    <rect width="1200" height="630" fill="#000000" />
    
    <!-- Subtle architectural lattice grid mapping -->
    <g opacity="0.12">
      <!-- Horizontal lines -->
      <line x1="0" y1="80" x2="1200" y2="80" stroke="#FFFFFF" stroke-width="1.5" />
      <line x1="0" y1="180" x2="1200" y2="180" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
      <line x1="0" y1="280" x2="1200" y2="280" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
      <line x1="0" y1="380" x2="1200" y2="380" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
      <line x1="0" y1="480" x2="1200" y2="480" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
      <line x1="0" y1="550" x2="1200" y2="550" stroke="#FFFFFF" stroke-width="1.5" />
      
      <!-- Vertical lines -->
      <line x1="120" y1="0" x2="120" y2="630" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
      <line x1="360" y1="0" x2="360" y2="630" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
      <line x1="600" y1="0" x2="600" y2="630" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
      <line x1="840" y1="0" x2="840" y2="630" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
      <line x1="1080" y1="0" x2="1080" y2="630" stroke="#FFFFFF" stroke-dasharray="8 8" stroke-width="1" />
    </g>

    <!-- Sleek inner terminal border border line -->
    <rect x="25" y="25" width="1150" height="580" rx="16" stroke="#222222" stroke-width="2.5" />
    
    <!-- Top left window status buttons -->
    <circle cx="65" cy="60" r="10" class="glow-red" />
    <circle cx="100" cy="60" r="10" class="glow-yellow" />
    <circle cx="135" cy="60" r="10" class="glow-green" />
    
    <!-- Header Terminal metadata details -->
    <text x="180" y="66" fill="#F95C4B" font-size="15" font-weight="800" letter-spacing="4px" class="term-text font-black">BOEKI SYSTEM PREVIEW</text>
    <text x="500" y="66" fill="#444444" font-size="14" class="term-text">[SECURE_TLS: 1.3] [PORT: 3000]</text>
    <text x="1135" y="66" fill="#666666" font-size="13" text-anchor="end" class="term-text">LOC: VERCEL.EDGE</text>
    
    <!-- Horizontal Header Line divider -->
    <line x1="25" y1="95" x2="1175" y2="95" stroke="#222222" stroke-width="2" />
    
    <!-- Left Margin System Track (Gives a highly polished quantitative look) -->
    <g opacity="0.3">
      <text x="50" y="160" fill="#888888" font-size="12" class="term-text font-bold">0x0182_INIT</text>
      <text x="50" y="200" fill="#888888" font-size="12" class="term-text font-bold">0x019E_EMBED</text>
      <text x="50" y="240" fill="#888888" font-size="12" class="term-text font-bold">0x021B_VECT</text>
      <text x="50" y="280" fill="#888888" font-size="12" class="term-text font-bold">0x03FF_SYNC</text>
      <text x="50" y="320" fill="#888888" font-size="12" class="term-text font-bold">0x04C0_CORE</text>
      <text x="50" y="360" fill="#888888" font-size="12" class="term-text font-bold">0x05F2_COMP</text>
      <text x="50" y="400" fill="#888888" font-size="12" class="term-text font-bold">0x1AC0_KERN</text>
    </g>

    <!-- Technical details frame box sidebars -->
    <text x="1135" y="150" fill="#444444" font-size="12" text-anchor="end" class="term-text">LATENCY: 1.2MS</text>
    <text x="1135" y="180" fill="#444444" font-size="12" text-anchor="end" class="term-text">RAG_CHUNKS: 05</text>
    <text x="1135" y="210" fill="#444444" font-size="12" text-anchor="end" class="term-text">MODEL: GEMINI_3.5_FLASH</text>
    <text x="1135" y="240" fill="#222222" font-size="12" text-anchor="end" class="term-text">STATUS: ACTIVE</text>
    
    <!-- Middle Core Display Area -->
    <!-- Console Prompt Header -->
    <text x="200" y="210" fill="#888888" font-size="18" class="term-text font-bold">guest@boeki:~$ <tspan fill="#4A5568">show --report</tspan></text>
    
    <!-- Large, pristine rendered dynamic main titles (Each line separated accurately) -->
    <g transform="translate(200, 290)">
      ${displayLines.map((line, index) => {
        const yOffset = index * 68;
        return `<text x="0" y="${yOffset}" fill="#FFFFFF" font-size="46" font-weight="800" class="term-text">${line}</text>`;
      }).join('\n')}
    </g>
    
    <!-- Footer line divider -->
    <line x1="25" y1="520" x2="1175" y2="520" stroke="#222222" stroke-width="2" />
    
    <!-- Active environment tag (Bottom left footer zone) -->
    <rect x="50" y="545" width="140" height="30" rx="6" fill="#F95C4B" fill-opacity="0.1" stroke="#F95C4B" stroke-opacity="0.2" stroke-width="1" />
    <circle cx="68" cy="560" r="5" fill="#F95C4B" />
    <text x="82" y="565" fill="#F95C4B" font-size="12" font-weight="700" class="term-text">DYNAMIC_OG</text>
    
    <text x="210" y="565" fill="#555555" font-size="13" class="term-text">ENGINE // SATORI_LITE_SECURE</text>
    
    <!-- 3-Pronged Custom Geometric Motif / "Octocat" tail reference in the bottom-right corner -->
    <!-- High-fidelity aesthetic matching user-bubble tail shapes -->
    <g opacity="0.6" transform="translate(1015, 520)">
      <!-- Prong 1 -->
      <path d="M120,0 L100,60 L80,60 L95,0 Z" fill="#F95C4B" />
      <!-- Prong 2 -->
      <path d="M75,0 L60,50 L40,50 L50,0 Z" fill="#F95C4B" />
      <!-- Prong 3 -->
      <path d="M35,0 L25,40 L10,40 L17,0 Z" fill="#F95C4B" />
    </g>
  </svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.status(200).send(svg);
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[HTTP Route ERROR] query flow failed:', {
      message: errorMessage,
      stack: errorStack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({
      success: false,
      error: 'RAG retrieval or premium synthesis failed',
      details: errorMessage
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

// 4c. POST /api/strategies/compare
// Compares two strategies side-by-side using Gemini and highlights divergent indicators
app.post('/api/strategies/compare', async (req, res) => {
  try {
    const { strategyA, strategyB } = req.body;
    if (!strategyA || !strategyB) {
      res.status(400).json({ error: 'Missing strategyA or strategyB in request body.' });
      return;
    }

    console.log(`[HTTP Route] Comparing strategies: "${strategyA.strategyName}" vs "${strategyB.strategyName}"`);

    const systemInstruction = `
You are a elite quantitative trading analyst or quant developer checking indicator divergences between two strategies.
Look at the indicators, timeframes, entries, and risk rules of both strategies.
Identify shared and divergent indicators.
Determine if they have synergistic, confirmation, or conflicting effects on trade validation.

You MUST respond strictly with a JSON object containing the comparative analysis. Under no circumstances should you wrap the output in any conversational text or formatting other than a single clean JSON code snippet or raw JSON.

Output format required:
{
  "compatibilityScore": number (value between 10 and 100),
  "sharedIndicators": string[],
  "divergentIndicators": {
    "strategyAOnly": string[],
    "strategyBOnly": string[]
  },
  "divergenceAnalysis": "Detailed paragraph of highlighting divergent indicators, their respective roles, and how they challenge or enrich the other strategy, formatted in standard Markdown.",
  "entryComparison": "Comparative summary analysis under entry conditions long and short, in Markdown.",
  "exitComparison": "Comparative critique of exit triggers (stop loss, take profit targets, criteria) in Markdown.",
  "synergyCheck": "Conclusion on whether to run these strategies in tandem (or side-by-side) or avoid mixing them. Elaborate on their confirmation bias or signal overlap, in Markdown."
}
`;

    const prompt = `
Strategy A Info:
- Name: ${strategyA.strategyName}
- Timeframe: ${strategyA.timeframe}
- Indicators: ${JSON.stringify(strategyA.indicators)}
- Entry conditions (Long): ${strategyA.entryConditionsLong || strategyA.entryConditions || 'N/A'}
- Entry conditions (Short): ${strategyA.entryConditionsShort || 'N/A'}
- Exit conditions: ${strategyA.exitConditions}
- Risk rules: ${strategyA.riskRules || 'N/A'}

Strategy B Info:
- Name: ${strategyB.strategyName}
- Timeframe: ${strategyB.timeframe}
- Indicators: ${JSON.stringify(strategyB.indicators)}
- Entry conditions (Long): ${strategyB.entryConditionsLong || strategyB.entryConditions || 'N/A'}
- Entry conditions (Short): ${strategyB.entryConditionsShort || 'N/A'}
- Exit conditions: ${strategyB.exitConditions}
- Risk rules: ${strategyB.riskRules || 'N/A'}

Analyze the physical divergences between indicators and conditions of both. Perform comparative quantitative analysis of strategy entry logic and highlight indicator conflicts!
`;

    const rawResponse = await generateTextContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      systemInstruction
    });

    // Clean response of any possible markdown JSON formatting markers
    let cleanJson = rawResponse.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.substring(7);
    }
    if (cleanJson.endsWith('```')) {
      cleanJson = cleanJson.substring(0, cleanJson.length - 3);
    }
    cleanJson = cleanJson.trim();

    const comparisonResult = JSON.parse(cleanJson);
    res.json({ success: true, comparison: comparisonResult });

  } catch (error: any) {
    console.error('[HTTP Route ERROR] Strategy comparison failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete strategy side-by-side comparison',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// 5. Standalone server starter for local runs
async function startServer() {
  // Integrate Vite as developer asset server middleware or build asset server
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
      const fs = require('fs');
      const indexPath = path.join(distPath, 'index.html');
      
      fs.readFile(indexPath, 'utf8', (err, html) => {
        if (err || !html) {
          return res.sendFile(indexPath);
        }
        
        // Dynamically deduce the preview title from the route path or request parameter
        let title = 'Trading Intelligence System';
        if (req.query.title) {
          title = String(req.query.title);
        } else {
          const parts = req.path.split('/').filter(Boolean);
          if (parts.length > 0) {
            title = parts[parts.length - 1]
              .replace(/[-_]+/g, ' ')
              .replace(/\b\w/g, c => c.toUpperCase());
          }
        }
        
        const host = req.headers.host || 'boeki.vercel.app';
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const ogImageUrl = `${protocol}://${host}/api/og?title=${encodeURIComponent(title)}`;
        
        // Inject custom meta rules directly before presenting to the client or scraping agent
        const customizedHtml = html
          .replace(/<title>.*?<\/title>/, `<title>${title} | Boeki</title>`)
          .replace(/content="\/boeki-preview\.png"/g, `content="${ogImageUrl}"`)
          .replace(/content="Boeki \| Quantitative Trading Analysis"/g, `content="${title} | Boeki"`);
          
        res.setHeader('Content-Type', 'text/html');
        res.status(200).send(customizedHtml);
      });
    });
  }

  // Start listening securely on the platform interface
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`  Hybrid Express Server Active!         `);
    console.log(`  Listening on http://0.0.0.0:${PORT}    `);
    console.log(`=========================================`);
  });
}

// Global exception handling and prevention of unhandled promise leaks on Serverless Vercel
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION PREVENTED]:', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION PREVENTED]:', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    timestamp: new Date().toISOString()
  });
});

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('[FATAL SERVER ERROR] Failed to bootstrap Express + Vite server:', err);
    process.exit(1);
  });
}

export { app };
export default app;
