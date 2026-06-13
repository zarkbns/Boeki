/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from '@google/genai';

let geminiClientInstance: GoogleGenAI | null = null;

/**
 * Lazy initializer for the modern Google GenAI SDK client.
 * Guarantees that the app does not crash at startup if the API key is temporarily missing,
 * providing a clear, developer-friendly validation error at execution time.
 */
export function getGeminiClient(): GoogleGenAI {
  if (!geminiClientInstance) {
    let apiKey = process.env.GEMINI_API_KEY;
    
    if (apiKey) {
      const uppercaseKey = apiKey.toUpperCase();
      if (
        apiKey.trim() === '' ||
        uppercaseKey.includes('PLACEHOLDER') ||
        uppercaseKey.startsWith('YOUR_') ||
        uppercaseKey.startsWith('MY_')
      ) {
        apiKey = undefined;
      }
    }

    // Fallback to import.meta.env if client-bound or browser context
    if (!apiKey) {
      try {
        const metaEnv = (import.meta as any).env;
        let envKey = metaEnv?.GEMINI_API_KEY || metaEnv?.VITE_GEMINI_API_KEY;
        if (envKey) {
          const uppercaseEnvKey = envKey.toUpperCase();
          if (
            envKey.trim() !== '' &&
            !uppercaseEnvKey.includes('PLACEHOLDER') &&
            !uppercaseEnvKey.startsWith('YOUR_') &&
            !uppercaseEnvKey.startsWith('MY_')
          ) {
            apiKey = envKey;
          }
        }
      } catch (e) {
        // Ignore ReferenceError on non-client environments
      }
    }

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is missing. Please provide it in your Secrets / Environment panel.');
    }
    
    geminiClientInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return geminiClientInstance;
}

/**
 * Generates an embedding vector using Vertex AI's text-embedding-005 model.
 * Falls back to text-embedding-004 if 005 meets regional model availability blocks.
 */
export async function generateEmbeddingVector(text: string): Promise<number[]> {
  const client = getGeminiClient();
  const modelsToTry = ['text-embedding-005', 'text-embedding-004', 'gemini-embedding-2-preview'];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    try {
      const response = await client.models.embedContent({
        model: modelName,
        contents: text,
      });
      
      const anyResponse = response as any;
      const embedding = anyResponse.embedding;
      if (embedding && embedding.values) {
        return embedding.values;
      }
      
      // Some versions of response return the list directly or inside embeddings
      if (anyResponse.embeddings && anyResponse.embeddings[0]?.values) {
        return anyResponse.embeddings[0].values;
      }
    } catch (error) {
      console.warn(`Embedding with model ${modelName} failed, trying fallback:`, error);
      lastError = error;
    }
  }

  throw new Error(`Failed to generate embedding with any known models. Last error: ${lastError?.message || lastError}`);
}

/**
 * Helper to call Gemini models with deep resilience:
 * - Dynamic fallback model pipeline for Pro and Flash categories
 * - Automatic exponential backoff retries for transient HTTP 429 (quota) or 503 (high demand) errors
 * - Fast failover mechanism to bypass futile retries on persistent daily/billing quota exhaustions
 */
export async function generateContentWithResilience(
  model: string,
  contents: any,
  config?: any
): Promise<any> {
  const client = getGeminiClient();

  // Create priority queue of models to try
  const modelsToTry: string[] = [model];
  
  if (model.toLowerCase().includes('pro')) {
    modelsToTry.push('gemini-3.1-pro-preview');
    modelsToTry.push('gemini-3.5-flash');
    modelsToTry.push('gemini-3.1-flash-lite');
    modelsToTry.push('gemini-flash-latest');
  } else {
    modelsToTry.push('gemini-3.5-flash');
    modelsToTry.push('gemini-3.1-flash-lite');
    modelsToTry.push('gemini-flash-latest');
  }

  const uniqueModels = Array.from(new Set(modelsToTry));
  let lastError: any = null;

  for (const modelToRun of uniqueModels) {
    let attempts = 3;
    let delay = 1500;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        console.log(`[Gemini Resilience] Invoking model '${modelToRun}' (Attempt ${attempt}/${attempts})...`);
        const response = await client.models.generateContent({
          model: modelToRun,
          contents,
          config
        });
        return response;
      } catch (error: any) {
        lastError = error;
        const errMsg = error?.message || String(error);
        const errStatus = error?.status || error?.code || 0;

        console.warn(`[Gemini Resilience WARNING] Model '${modelToRun}' failed on attempt ${attempt}: ${errMsg}`);

        const isQuota = errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate') || errStatus === 'RESOURCE_EXHAUSTED' || errStatus === 429;
        const isUnavailable = errMsg.toLowerCase().includes('unavailable') || errMsg.toLowerCase().includes('demand') || errStatus === 'UNAVAILABLE' || errStatus === 503;

        // Check for persistent, non-transient daily/billing quota limit caps
        const normMsg = errMsg.toLowerCase();
        const isPersistentQuota = 
          normMsg.includes('exceeded your current quota') ||
          normMsg.includes('billing details') ||
          normMsg.includes('quota exceeded for metric') ||
          normMsg.includes('free_tier_requests') ||
          (normMsg.includes('limit:') && normMsg.includes('quota'));

        if (isPersistentQuota) {
          console.warn(`[Gemini Resilience] Hard/billing quota reached for '${modelToRun}'. Fast-failing to alternative model...`);
          break; // Avoid futile retries on a model that is permanently exhausted for the day
        }

        if (attempt < attempts && (isQuota || isUnavailable)) {
          const actualDelay = delay * attempt;
          console.log(`[Gemini Resilience] Temporary load/quota issue. Pausing ${actualDelay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, actualDelay));
        } else {
          // If the model itself is not permitted/invalid or we used all attempts, try the next model
          break;
        }
      }
    }
  }

  throw new Error(`[Gemini Resilience CRITICAL] All high-reliability fallback models failed. Last error: ${lastError?.message || lastError}`);
}

/**
 * Helper to call Gemini models cleanly for text generation.
 * Supports gemini-3.5-flash and gemini-3.1-pro-preview.
 */
export async function generateTextContent(params: {
  model: 'gemini-3.5-flash' | 'gemini-3.1-pro-preview' | string;
  contents: string;
  systemInstruction?: string;
}): Promise<string> {
  const response = await generateContentWithResilience(
    params.model,
    params.contents,
    params.systemInstruction ? { systemInstruction: params.systemInstruction } : undefined
  );

  const text = response.text;
  if (!text) {
    throw new Error('Gemini model returned empty response text.');
  }
  
  return text;
}
