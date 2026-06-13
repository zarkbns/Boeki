/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { genkit, z } from 'genkit';
import { Type } from '@google/genai';
import { db } from './firestore-setup';
import { 
  collection, 
  addDoc,
  getDocs, 
  query as firestoreQuery,
  limit as firestoreLimit,
  where as firestoreWhere
} from 'firebase/firestore';
import { extractYoutubeId, fetchYoutubeTranscript, extractPlaylistId, fetchPlaylistVideoUrls, extractAndStoreTradingStrategy } from './youtube-utils';
import { 
  getGeminiClient, 
  generateTextContent,
  generateContentWithResilience
} from './gemini-client';
import { fetchCoinMarketData, resolveCoinId } from './coingecko-tool';

// Initialize unified Genkit instance
const aiGenkit = genkit({});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface TradingRule {
  strategyName: string;
  timeframe: string;
  indicators: string[];
  entryConditionsLong: string;
  entryConditionsShort: string;
  exitConditions: string;
  riskRules: string;
  rawRulesText: string;
}

/**
 * 1. INGESTION PIPELINE FLOW (Trading Strategies)
 * Accepts a public YouTube video URL (beginner trading guide), extracts Technical Trading Rules using Gemini,
 * and saves them into the Firestore collection 'trading_strategies' as JSON objects. Drops Vector embedding.
 */
export const ingestVideoFlow = aiGenkit.defineFlow(
  {
    name: 'ingestVideoFlow',
    inputSchema: z.object({
      youtubeUrl: z.string().url({ message: 'Must be a valid YouTube URL' }),
      userId: z.string().optional()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      videoId: z.string(),
      strategiesExtracted: z.number(),
      message: z.string(),
      strategies: z.array(z.any())
    }),
  },
  async (input) => {
    const playlistId = extractPlaylistId(input.youtubeUrl);
    
    // 1. YouTube PLAYLIST ingestion path
    if (playlistId) {
      console.log(`[Ingest] Ingesting YouTube Playlist: ${playlistId}`);
      const videoUrls = await fetchPlaylistVideoUrls(playlistId);
      
      if (videoUrls.length === 0) {
        throw new Error(`The target YouTube playlist '${playlistId}' did not return any parseable videos.`);
      }

      // Limit playlist items to process in one trigger to avoid aggressive quota/rate limit burnout (max 5)
      const maxBatchVideos = 5;
      const targetUrls = videoUrls.slice(0, maxBatchVideos);
      console.log(`[Ingest] Parsing playlist block (processing first ${targetUrls.length} out of ${videoUrls.length} total videos)...`);

      const allExtractedStrategies: any[] = [];
      let totalSavedCount = 0;
      const strategiesCol = collection(db, 'trading_strategies');

      for (const url of targetUrls) {
        const currentVidId = extractYoutubeId(url);
        if (!currentVidId) continue;

        try {
          console.log(`[Playlist Ingest] Processing video ID: ${currentVidId}`);
          const transcript = await fetchYoutubeTranscript(currentVidId);
          console.log(`[Playlist Ingest] Retrieved transcript (${transcript.length} chars) for ${currentVidId}. Extraction starts...`);

          const client = getGeminiClient();
          const systemInstruction = `
You are an expert Cryptocurrency & Financial Markets Asset Analyst and Quantitative Strategist. 
Your job is to read technical trading guides and extract actionable "Trading Rules" into a highly structured JSON array of strategies.
Do NOT output any code blocks, Rust, Sol, React, or software development scripts. Focus purely on trading indicators, triggers, setups, exits, and risk variables.

For each distinct strategy parsed, build an object according to this schema:
- strategyName: String (Title of the strategy, e.g. "EMA 20/50 Trend Cross")
- timeframe: String (recommended charts, like "5-minute", "1-hour", "Daily")
- indicators: Array of Strings (The specific technical indicators required, e.g., ["MACD", "EMA 200", "RSI"])
- entryConditionsLong: String (Clear bullish entry criteria)
- entryConditionsShort: String (Clear bearish entry criteria)
- exitConditions: String (Stop loss details, profit targets, indicators confirmations)
- riskRules: String (Position sizing or risk management rule)
- rawRulesText: String (A continuous narrative text block combining these rules into a robust explanation)
`;

          const modelResponse = await generateContentWithResilience(
            'gemini-3.5-flash',
            `Analyze this trading tutorial transcript for video ID: ${currentVidId}\n\nTranscript Content:\n${transcript}`,
            {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                description: 'List of technical trading strategies extracted from the tutorial.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    strategyName: { type: Type.STRING },
                    timeframe: { type: Type.STRING },
                    indicators: { 
                      type: Type.ARRAY, 
                      items: { type: Type.STRING } 
                    },
                    entryConditionsLong: { type: Type.STRING },
                    entryConditionsShort: { type: Type.STRING },
                    exitConditions: { type: Type.STRING },
                    riskRules: { type: Type.STRING },
                    rawRulesText: { type: Type.STRING }
                  },
                  required: ['strategyName', 'timeframe', 'indicators', 'entryConditionsLong', 'entryConditionsShort', 'exitConditions', 'riskRules', 'rawRulesText']
                }
              }
            }
          );

          const generatedText = modelResponse.text;
          if (!generatedText) {
            console.warn(`[Playlist Ingest] Video ${currentVidId} returned empty analysis response.`);
            continue;
          }

          const videoStrategies: TradingRule[] = JSON.parse(generatedText);
          console.log(`[Playlist Ingest] Successfully extracted ${videoStrategies.length} trading strategies for video ${currentVidId}.`);

          for (const strat of videoStrategies) {
            const docData = {
              ...strat,
              videoId: currentVidId,
              videoUrl: url,
              userId: input.userId || null,
              createdAt: new Date().toISOString()
            };
            try {
              await addDoc(strategiesCol, docData);
              totalSavedCount++;
              allExtractedStrategies.push({
                ...docData,
                id: `playlist-${currentVidId}-${totalSavedCount}`
              });
            } catch (error: any) {
              if (error && (error.code === 'permission-denied' || String(error).includes('permission'))) {
                handleFirestoreError(error, OperationType.CREATE, 'trading_strategies');
              }
              throw error;
            }
          }
        } catch (videoError: any) {
          console.error(`[Playlist Ingest ERROR] Skipping video ${currentVidId} because of processing failure:`, videoError?.message || videoError);
        }
      }

      return {
        success: true,
        videoId: `playlist-${playlistId}`,
        strategiesExtracted: totalSavedCount,
        message: `Successfully ingested YouTube Playlist. Processed first ${targetUrls.length} videos from the playlist, successfully extracted & stored ${totalSavedCount} high-conviction indicator strategies inside Firestore collection 'trading_strategies'.`,
        strategies: allExtractedStrategies
      };
    }

    // 2. SINGLE VIDEO ingestion path
    console.log(`[Ingest] Ingesting YouTube video via strict template: ${input.youtubeUrl} (UserID: ${input.userId || 'anonymous'})`);
    const res = await extractAndStoreTradingStrategy(input.youtubeUrl, input.userId);
    return {
      success: res.success,
      videoId: res.videoId,
      strategiesExtracted: res.strategiesSaved,
      message: `Successfully ingested trading tutorial. Extracted and stored ${res.strategiesSaved} high-conviction strategies inside Firestore collection 'trading_strategies'.`,
      strategies: res.strategies
    };
  }
);

/**
 * Helper to determine which coin is being referenced in the user's natural query.
 * Calls Gemini with standard lightweight prompt for bulletproof classification.
 */
async function detectCoinIdFromQuery(queryText: string): Promise<string> {
  const client = getGeminiClient();
  const prompt = `
Task: Analyze the user's natural language search query and extract the primary cryptocurrency name or ticker symbol they are asking about (for example: 'bitcoin', 'btc', 'solana', 'sol', 'pepe', 'ethereum', 'eth', 'cardano', 'ada', etc.).

Return ONLY the lowercase name or ticker of the cryptocurrency. Do NOT include any explanations, surrounding punctuation, markup, or markdown blocks. Just the raw lowercase word.
If no specific coin is mentioned at all, return 'solana' as a default.

User Input: "${queryText}"
Primary Coin Identifier:`;

  try {
    const response = await generateTextContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });
    const parsed = response.trim().toLowerCase().replace(/[^a-z0-9\- ]/g, '');
    return resolveCoinId(parsed);
  } catch (error) {
    console.warn('Failed to detect coin via Gemini, falling back to substring search:', error);
    // Simple substring fallback
    const lower = queryText.toLowerCase();
    if (lower.includes('btc') || lower.includes('bitcoin')) return 'bitcoin';
    if (lower.includes('eth') || lower.includes('ethereum')) return 'ethereum';
    if (lower.includes('sol') || lower.includes('solana')) return 'solana';
    if (lower.includes('mnt') || lower.includes('mantle')) return 'mantle';
    if (lower.includes('ada') || lower.includes('cardano')) return 'cardano';
    if (lower.includes('xrp') || lower.includes('ripple')) return 'ripple';
    if (lower.includes('doge') || lower.includes('dogecoin')) return 'dogecoin';
    if (lower.includes('pepe')) return 'pepe';
    if (lower.includes('shib')) return 'shiba-inu';
    return 'solana';
  }
}

const fetchLiveMarketDataDecl = {
  name: 'fetchLiveMarketData',
  description: 'Fetch real-time cryptographic market ticker data (current price, 24h volume, 24h change) for a specific cryptocurrency coin/token. Use when the user naturally brings up a specific coin or asks about current prices.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      coinIdentifier: {
        type: Type.STRING,
        description: 'The name or ticker symbol of the coin (e.g. solana, sol, btc, bitcoin, pepe, eth, ethereum, etc.)'
      }
    },
    required: ['coinIdentifier']
  }
};

const getStoredTradingStrategiesDecl = {
  name: 'getStoredTradingStrategies',
  description: 'Retrieve custom-ingested quant trading strategies and technical rules (long/short entry targets, risk limits, stop losses, timeframes, indicators) saved in the user\'s Firestore strategies library dataset.',
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

function parseBase64Image(dataUrl: string) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!match) {
    if (dataUrl.length > 100 && !dataUrl.includes(',')) {
      return { mimeType: 'image/png', data: dataUrl };
    }
    return null;
  }
  return {
    mimeType: match[1],
    data: match[2]
  };
}

function resolveImagePart(imageField: any) {
  if (!imageField) return null;
  if (typeof imageField === 'object' && imageField.data && imageField.mimeType) {
    return {
      inlineData: {
        mimeType: imageField.mimeType,
        data: imageField.data
      }
    };
  }
  const parsedImg = parseBase64Image(imageField);
  if (parsedImg) {
    return {
      inlineData: {
        mimeType: parsedImg.mimeType,
        data: parsedImg.data
      }
    };
  }
  return null;
}

function mapHistoryToGeminiContents(history: any[]): any[] {
  const contents: any[] = [];
  for (const msg of history) {
    if (msg.id === 'welcome') continue; // Skip simulated greetings
    const role = msg.sender === 'user' ? 'user' : 'model';
    const parts: any[] = [];
    if (msg.text) {
      parts.push({ text: msg.text });
    }
    if (msg.sender === 'user' && msg.image) {
      const imagePart = resolveImagePart(msg.image);
      if (imagePart) {
        parts.push(imagePart);
      }
    }
    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }
  return contents;
}

/**
 * 2. CHAT / KNOWLEDGE QUERY FLOW
 * Supports dynamic conversation turns, attached chart screenshots, and calls Gemini Pro.
 * Preserves the open-ended thought partner behavior, calling tools only when requested.
 */
export const queryKnowledgeFlow = aiGenkit.defineFlow(
  {
    name: 'queryKnowledgeFlow',
    inputSchema: z.object({
      query: z.string().min(1, { message: 'Query must be specified' }),
      maxStrategies: z.number().optional().default(3),
      history: z.array(z.any()).optional(),
      image: z.any().optional()
    }),
    outputSchema: z.object({
      answer: z.string(),
      coinData: z.any(),
      strategiesUsed: z.array(z.any())
    }),
  },
  async (input) => {
    console.log(`[Query Engine] Executing chat stream for query: "${input.query}"`);

    // Build multi-turn conversational contents
    let contents: any[] = [];
    if (input.history && input.history.length > 0) {
      contents = mapHistoryToGeminiContents(input.history);
    } else {
      const parts: any[] = [{ text: input.query }];
      const imagePart = resolveImagePart(input.image);
      if (imagePart) {
        parts.push(imagePart);
      }
      contents = [{ role: 'user', parts }];
    }

    const sysInst = `You are an expert, observant crypto research assistant and conversational peer. Your goal is to engage in open-ended, deep discussions about cryptocurrency, macro trends, tech architecture, and market psychology. 

You have access to two hidden tools: \`fetchLiveMarketData\` and a Firestore collection of \`trading_strategies\`. Do not force a rigid structure on the conversation. Only call the live market data tool or reference the saved strategy rules if the user naturally brings up a specific coin or explicitly asks you to evaluate a market setup against their rules. If they attach a chart screenshot, analyze its visual elements alongside the conversation.`;

    console.log('[Query Engine] Invoking Gemini with multi-turn chat capabilities & dynamic tool parameters...');
    let coinDataUsed: any = null;
    let strategiesUsed: any[] = [];
    let compiledResponse = '';

    try {
      // Use Gemini 1.5 Pro when image exists, otherwise gemini-3.5-flash
      const targetModel = input.image ? 'gemini-1.5-pro' : 'gemini-3.5-flash';

      // First call to model with registered tools
      const response = await generateContentWithResilience(
        targetModel,
        contents,
        {
          systemInstruction: sysInst,
          tools: [{ functionDeclarations: [fetchLiveMarketDataDecl, getStoredTradingStrategiesDecl] }],
          toolConfig: { includeServerSideToolInvocations: true }
        }
      );

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        console.log('[Query Engine] Gemini generated tool calls:', functionCalls);
        const toolResponseParts: any[] = [];
        const modelTurnContent = response.candidates?.[0]?.content;

        for (const call of functionCalls) {
          if (call.name === 'fetchLiveMarketData') {
            const { coinIdentifier } = call.args as any;
            console.log(`[Query Engine] Executing Tool: fetchLiveMarketData with ID/Symbol: "${coinIdentifier}"`);
            const coinId = resolveCoinId(coinIdentifier);
            try {
              const marketData = await fetchCoinMarketData(coinId);
              coinDataUsed = marketData;
              toolResponseParts.push({
                functionResponse: {
                  name: 'fetchLiveMarketData',
                  response: { result: marketData }
                }
              });
            } catch (e: any) {
              console.warn(`[Query Engine Warning] Tool live fetch failed:`, e);
              toolResponseParts.push({
                functionResponse: {
                  name: 'fetchLiveMarketData',
                  response: { error: e.message || String(e) }
                }
              });
            }
          } else if (call.name === 'getStoredTradingStrategies') {
            console.log('[Query Engine] Executing Tool: getStoredTradingStrategies');
            try {
              let listArr = await getStoredStrategies();
              if (listArr.length === 0) {
                // Baseline preloaded strategies fallback
                listArr = [
                  {
                    strategyName: "The Double Exponential Moving Average (EMA) & MACD Trend System",
                    timeframe: "1-hour / 4-hour charts",
                    indicators: ["20 EMA", "50 EMA", "MACD", "Signal Line"],
                    entryConditionsLong: "20 EMA crosses above the 50 EMA, and the MACD line crosses above the Signal line below the zero axis.",
                    entryConditionsShort: "20 EMA crosses below the 50 EMA, and the MACD line crosses below the Signal line.",
                    exitConditions: "Stop-loss slightly below the recent swing low, profit targets modeled on a 2:1 Reward-to-Risk ratio.",
                    riskRules: "Never risk more than 1% to 2% of total capital on a single transaction.",
                    rawRulesText: "Plots fast EMA (20) and slow EMA (50) to buy golden crosses or short death crosses alongside MACD momentum verification. Perfect for steady trading ranges."
                  },
                  {
                    strategyName: "RSI Momentum Support & Resistance Breakout System",
                    timeframe: "4-hour timeframes",
                    indicators: ["RSI", "Horizontal Support & Resistance Ranges"],
                    entryConditionsLong: "Price candle closes cleanly above a long-term key horizontal resistance level, while RSI shows bullish momentum above 55.",
                    entryConditionsShort: "Price candle closes cleanly below support, while RSI trades below 45.",
                    exitConditions: "Stop-loss set at range midpoint. Take partial profit at next major level and trail remainder with 9 Hull Average.",
                    riskRules: "Hard stop limits active. Risk 1% of account.",
                    rawRulesText: "Monitors horizontal breakout bounds. Confirms real breakout velocity versus false deviations utilizing RSI relative bounds."
                  }
                ];
              }
              strategiesUsed = listArr;
              toolResponseParts.push({
                functionResponse: {
                  name: 'getStoredTradingStrategies',
                  response: { result: listArr }
                }
              });
            } catch (e: any) {
              console.warn(`[Query Engine Warning] Tool getStoredTradingStrategies failed:`, e);
              toolResponseParts.push({
                functionResponse: {
                  name: 'getStoredTradingStrategies',
                  response: { error: e.message || String(e) }
                }
              });
            }
          }
        }

        const modelTurn = {
          role: 'model',
          parts: modelTurnContent?.parts || []
        };
        const toolTurn = {
          role: 'tool',
          parts: toolResponseParts
        };

        const contentChain = [
          ...contents,
          modelTurn,
          toolTurn
        ];

        console.log('[Query Engine] Re-invoking Gemini for final analytical report with executed tool outputs...');
        const finalResponse = await generateContentWithResilience(
          targetModel,
          contentChain,
          {
            systemInstruction: sysInst,
            tools: [{ functionDeclarations: [fetchLiveMarketDataDecl, getStoredTradingStrategiesDecl] }],
            toolConfig: { includeServerSideToolInvocations: true }
          }
        );

        compiledResponse = finalResponse.text || "I executed the quantitative rules tool checks, but generated an empty report.";
      } else {
        compiledResponse = response.text || "No response text compiled.";
      }
    } catch (error: any) {
      console.error('[Query Engine ERROR] Deep multi-turn synthesis failed:', error);
      throw error;
    }

    return {
      answer: compiledResponse,
      coinData: coinDataUsed,
      strategiesUsed: strategiesUsed
    };
  }
);

/**
 * Helper to fetch all stored trading strategies from the Firestore collection.
 */
export async function getStoredStrategies(userId?: string): Promise<any[]> {
  const strategiesCol = collection(db, 'trading_strategies');
  try {
    let q;
    if (userId) {
      q = firestoreQuery(strategiesCol, firestoreWhere('userId', '==', userId), firestoreLimit(25));
    } else {
      q = firestoreQuery(strategiesCol, firestoreLimit(25));
    }
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...(doc.data() as any)
    }));
  } catch (error: any) {
    if (error && (error.code === 'permission-denied' || String(error).includes('permission'))) {
      handleFirestoreError(error, OperationType.LIST, 'trading_strategies');
    }
    console.warn('Failed to fetch from Firestore trading_strategies:', error);
    return [];
  }
}

