/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fetch from 'node-fetch';
import { genkit, z } from 'genkit';

const ai = genkit({});

export interface CoinMarketData {
  coinId: string;
  name: string;
  symbol: string;
  priceUsd: number;
  volume24h: number;
  change24h: number;
  timestamp: string;
  isFallback: boolean;
}

/**
 * Technical database mapping of coin names to coingecko identifiers and standard baseline rates.
 */
const COIN_REGISTRY: Record<string, { name: string; symbol: string; basePrice: number }> = {
  bitcoin: { name: 'Bitcoin', symbol: 'BTC', basePrice: 68500 },
  ethereum: { name: 'Ethereum', symbol: 'ETH', basePrice: 3450 },
  solana: { name: 'Solana', symbol: 'SOL', basePrice: 165.5 },
  mantle: { name: 'Mantle', symbol: 'MNT', basePrice: 0.85 },
  cardano: { name: 'Cardano', symbol: 'ADA', basePrice: 0.48 },
  ripple: { name: 'Ripple', symbol: 'XRP', basePrice: 0.59 },
  dogecoin: { name: 'Dogecoin', symbol: 'DOGE', basePrice: 0.14 },
};

/**
 * Universal ticker symbol matching database
 */
const SYMBOL_TO_ID: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  mnt: 'mantle',
  ada: 'cardano',
  xrp: 'ripple',
  doge: 'dogecoin',
  pepe: 'pepe',
  shib: 'shiba-inu',
  link: 'chainlink',
  uni: 'uniswap',
  avax: 'avalanche-2',
  dot: 'polkadot',
  near: 'near',
  matic: 'matic-network',
  polygon: 'matic-network',
  trx: 'tron',
  ltc: 'litecoin',
  bch: 'bitcoin-cash',
  apt: 'aptos',
  sui: 'sui',
  fil: 'filecoin',
  render: 'render-token',
  ftm: 'fantom',
  atom: 'cosmos',
  etc: 'ethereum-classic',
  hbar: 'hedera-hashgraph',
  vet: 'vechain',
  icp: 'internet-computer',
  op: 'optimism',
  arb: 'arbitrum',
  kas: 'kaspa',
  imx: 'immutable-x',
  inj: 'injective-protocol',
  stx: 'blockstack',
  ldo: 'lido-dao',
  grt: 'the-graph',
  gala: 'gala',
  rndr: 'render-token',
  wif: 'dogwifhat',
  bonk: 'bonk',
  floki: 'floki',
};

/**
 * Normalizes query string input into standard CoinGecko identifier.
 * Maps tickers using the universal SYMBOL_TO_ID dictionary, and formats name queries to lowercase hyphenated format.
 */
export function resolveCoinId(text: string): string {
  const clean = text.trim().toLowerCase().replace(/[^a-z0-9\- ]/g, '');
  
  if (SYMBOL_TO_ID[clean]) {
    return SYMBOL_TO_ID[clean];
  }

  // Direct exact registry matches
  if (COIN_REGISTRY[clean]) {
    return clean;
  }

  // Symbol or colloquial matches
  if (clean === 'btc' || clean.includes('bitcoin')) return 'bitcoin';
  if (clean === 'eth' || clean.includes('ethereum')) return 'ethereum';
  if (clean === 'sol' || clean.includes('solana')) return 'solana';
  if (clean === 'mnt' || clean.includes('mantle')) return 'mantle';
  if (clean === 'ada' || clean.includes('cardano')) return 'cardano';
  if (clean === 'xrp' || clean.includes('ripple')) return 'ripple';
  if (clean === 'doge' || clean.includes('dogecoin')) return 'dogecoin';

  // Replace whitespace sequences with a single hyphen for standard CoinGecko search format
  const withHyphens = clean.replace(/\s+/g, '-');
  return withHyphens || 'solana';
}

export interface LiveMarketOutput {
  current_price: number;
  total_volume: number;
  price_change_percentage_24h: number;
  isFallback: boolean;
}

/**
 * Genkit Tool called fetchLiveMarketData
 * Accepts a coinId string, queries CoinGecko's public endpoint:
 * https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}
 * Extracts current_price, total_volume, price_change_percentage_24h, and handles errors cleanly.
 */
export const fetchLiveMarketData = ai.defineTool(
  {
    name: 'fetchLiveMarketData',
    description: 'Query CoinGecko public market data for current_price, total_volume, and 24h price change percentage of a given cryptocurrency.',
    inputSchema: z.object({
      coinId: z.string().describe('CoinGecko cryptocurrency identifier (e.g., bitcoin, solana, ethereum)'),
    }),
    outputSchema: z.object({
      current_price: z.number(),
      total_volume: z.number(),
      price_change_percentage_24h: z.number(),
      isFallback: z.boolean(),
    }),
  },
  async ({ coinId }) => {
    const resolved = resolveCoinId(coinId);
    const metadata = COIN_REGISTRY[resolved] || { name: resolved.toUpperCase(), symbol: resolved.toUpperCase().slice(0, 4), basePrice: 100 };
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${resolved}`;
    
    try {
      console.log(`[fetchLiveMarketData Tool] Connecting to Coingecko: ${url}`);
      // Use standard global fetch if available, otherwise node-fetch
      const f = typeof globalThis.fetch === 'function' ? globalThis.fetch : fetch;
      const res = await f(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PersonalTradingAnalystChatbot/1.0'
        }
      });
      
      if (!res.ok) {
        throw new Error(`CoinGecko markets response failed with status: ${res.status}`);
      }
      
      const arr = await res.json() as any;
      if (Array.isArray(arr) && arr.length > 0) {
        const item = arr[0];
        const current_price = typeof item.current_price === 'number' ? item.current_price : metadata.basePrice;
        const total_volume = typeof item.total_volume === 'number' ? item.total_volume : (current_price * 1500000);
        const price_change_percentage_24h = typeof item.price_change_percentage_24h === 'number' ? item.price_change_percentage_24h : 1.5;
        
        return {
          current_price,
          total_volume,
          price_change_percentage_24h,
          isFallback: false
        };
      }
      
      throw new Error(`Unexpected empty array or format from CoinGecko markets: ${JSON.stringify(arr)}`);
    } catch (error) {
      console.warn(`[fetchLiveMarketData Tool] Error occurred, generating clean simulated fallback data: ${error instanceof Error ? error.message : error}`);
      
      const minuteFactor = new Date().getMinutes();
      const percentDev = ((minuteFactor % 31) - 15) / 100; // variations between -15% and +15%
      const finalPrice = Number((metadata.basePrice * (1 + percentDev)).toFixed(2));
      const finalChange = Number(((minuteFactor % 19) - 9).toFixed(2)); // mock between -9% and +9% change
      const mockVolume = Math.round(finalPrice * (2000000 + (minuteFactor * 120000)));
      
      return {
        current_price: finalPrice,
        total_volume: mockVolume,
        price_change_percentage_24h: finalChange,
        isFallback: true
      };
    }
  }
);

/**
 * Genkit Tool capability to fetch price, volume, and percentage changes from public CoinGecko API.
 * Employs a robust, beautiful simulated ticker fallback in case of rate-limiting or network issues in container sandbox.
 */
export async function fetchCoinMarketData(rawCoinId: string): Promise<CoinMarketData> {
  const coinId = resolveCoinId(rawCoinId);
  const metadata = COIN_REGISTRY[coinId] || { name: coinId.toUpperCase(), symbol: coinId.toUpperCase().slice(0, 4), basePrice: 100 };
  
  try {
    // Query public markets endpoint dynamically to support non-registered coins seamlessly
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinId}`;
    
    console.log(`[CoinGecko Tool] Connecting to external markets: ${url}`);
    
    // Choose appropriate fetch instance
    const f = typeof globalThis.fetch === 'function' ? globalThis.fetch : fetch;
    const res = await f(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PersonalTradingAnalystChatbot/1.0'
      }
    });
    
    if (!res.ok) {
      throw new Error(`CoinGecko markets response failed with status: ${res.status}`);
    }
    
    const arr = await res.json() as any;
    if (Array.isArray(arr) && arr.length > 0) {
      const item = arr[0];
      const usdPrice = typeof item.current_price === 'number' ? item.current_price : metadata.basePrice;
      const volume = typeof item.total_volume === 'number' ? item.total_volume : (usdPrice * 1250000);
      const prcChange = typeof item.price_change_percentage_24h === 'number' ? item.price_change_percentage_24h : 2.5;
      
      return {
        coinId,
        name: item.name || metadata.name,
        symbol: (item.symbol || metadata.symbol).toUpperCase(),
        priceUsd: usdPrice,
        volume24h: volume,
        change24h: prcChange,
        timestamp: new Date().toISOString(),
        isFallback: false
      };
    }
    
    throw new Error(`Unexpected empty array or format from CoinGecko markets: ${JSON.stringify(arr)}`);
  } catch (error) {
    console.warn(`[CoinGecko Tool warning] Ticker fetching failed, spinning up high-performance simulated ticker. error:`, error instanceof Error ? error.message : error);
    
    // To generate organic daily updates, let's inject a deterministic pseudo-random variation based on the current minute
    const minuteFactor = new Date().getMinutes();
    const percentDev = ((minuteFactor % 21) - 10) / 100; // between -10% and +10%
    const finalPrice = Number((metadata.basePrice * (1 + percentDev)).toFixed(2));
    const finalChange = Number(((minuteFactor % 13) - 6).toFixed(2)); // mock between -6% and +6% change
    const mockVolume = Math.round(finalPrice * (1500000 + (minuteFactor * 100000)));

    return {
      coinId,
      name: metadata.name,
      symbol: metadata.symbol,
      priceUsd: finalPrice,
      volume24h: mockVolume,
      change24h: finalChange,
      timestamp: new Date().toISOString(),
      isFallback: true
    };
  }
}
