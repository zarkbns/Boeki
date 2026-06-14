/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { 
  Youtube, 
  Sparkles, 
  Database, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Activity, 
  Coins, 
  X, 
  ChevronDown,
  Menu,
  Plus,
  Mic,
  FileText,
  Settings,
  User,
  Sun,
  Moon,
  ArrowRight,
  ChevronLeft,
  FileCheck,
  ChevronRight,
  RefreshCw,
  Send,
  Image as ImageIcon,
  Camera,
  Copy,
  Check,
  Palette
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import DrawingOverlay from './components/DrawingOverlay';
import { auth, db, storage } from './firestore-setup';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User as FirebaseUser,
  updateProfile
} from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  collection,
  query as firestoreQuery,
  where,
  getDocs,
  addDoc,
  doc,
  deleteDoc,
  serverTimestamp,
  updateDoc,
  onSnapshot,
  orderBy,
  limit
} from 'firebase/firestore';

interface TradingStrategy {
  id?: string;
  strategyName: string;
  timeframe: string;
  indicators: string[];
  entryConditionsLong?: string;
  entryConditionsShort?: string;
  entryConditions?: string;
  exitConditions: string;
  riskRules?: string;
  rawRulesText?: string;
  videoId?: string;
  videoUrl?: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  coinData?: any;
  strategiesUsed?: TradingStrategy[];
  image?: string;
}

interface ConversationHistory {
  id: string;
  topic: string;
  timestamp: string;
  indicators: string[];
  messages: ChatMessage[];
}

/**
 * Converts a browser File object to a base64 encoded string with standard metadata
 * and formats it into the Gemini API inlineData structure.
 */
export function encodeFileToInlineData(file: File): Promise<{
  inlineData: {
    mimeType: string;
    data: string;
  }
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = reader.result as string || '';
      const match = resultStr.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (match) {
        resolve({
          inlineData: {
            mimeType: match[1],
            data: match[2]
          }
        });
      } else {
        const commaIdx = resultStr.indexOf(',');
        if (commaIdx !== -1) {
          resolve({
            inlineData: {
              mimeType: file.type,
              data: resultStr.substring(commaIdx + 1)
            }
          });
        } else {
          reject(new Error("Failed to extract Base64 data from file"));
        }
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

// Format message timestamps using accurate client local time format
const formatMessageTime = (dateInput?: Date | number | string) => {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return "Just now";
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutesStr} ${ampm}`;
};

export default function App() {
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Authentication states
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Navigation: Page 1 (chat) <-> Page 2 (dashboard)
  const [currentPage, setCurrentPage] = useState<'chat' | 'dashboard' | 'admin'>('dashboard');
  const [theme] = useState<'dark' | 'light'>('light'); // Theme permanently set to light as requested

  // Easter Egg Quote Engine config
  const QUOTE_DATABASE = {
    panicVolatility: [
      { text: "October: This is one of the peculiarly dangerous months to speculate in stocks. The others are July, January, September, April, November, May, March, June, December, August, and February.", author: "Mark Twain" },
      { text: "Investing should be more like watching paint dry or watching grass grow. If you want excitement, take $800 and go to Las Vegas.", author: "Paul Samuelson" },
      { text: "Only when the tide goes out do you discover who's been swimming naked.", author: "Warren Buffett" },
      { text: "Bulls make money, bears make money, pigs get slaughtered.", author: "Wall Street Adage" },
      { text: "The stock market is a device for transferring money from the impatient to the patient.", author: "Warren Buffett" }
    ],
    popCultureMovies: [
      { text: "If you want a friend, get a dog.", author: "Gordon Gekko (Wall Street)" },
      { text: "Those are rookie numbers in this racket. You gotta pump those numbers up.", author: "Mark Hanna (The Wolf of Wall Street)" },
      { text: "The most valuable commodity I know of is information.", author: "Gordon Gekko (Wall Street)" },
      { text: "Look at me. I'm the captain of this trade now.", author: "Pop-Culture Meme" },
      { text: "Risk comes from not knowing what you're doing.", author: "Warren Buffett" }
    ],
    tradingPsychology: [
      { text: "There is a time to go long, a time to go short, and a time to go fishing.", author: "Jesse Livermore" },
      { text: "If most traders would learn to sit on their hands 50% of the time, they would make a lot more money.", author: "Bill Lipschutz" },
      { text: "The market can remain irrational longer than you can remain solvent.", author: "John Maynard Keynes" },
      { text: "In trading, you have to be defensive. If you don't defend your capital, you won't be around to play.", author: "Paul Tudor Jones" },
      { text: "Michael Jordan didn't become Michael Jordan by shooting three-pointers every single second of the day.", author: "Trading Psychology Adage" }
    ],
    cryptoMemes: [
      { text: "Are those paper hands I see? 🧻🤲" },
      { text: "Diamond hands activated. 💎🙌 To the moon!" },
      { text: "Buy high, sell low. This is the way." },
      { text: "Sir, this is a Wendy's." },
      { text: "Oops! This page just experienced a rug pull. 404 Error." }
    ]
  };

  const [activeQuote, setActiveQuote] = useState<{ text: string; author?: string; category: string } | null>(null);
  const quoteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerQuoteEngine = () => {
    if (quoteTimeoutRef.current) {
      clearTimeout(quoteTimeoutRef.current);
    }
    const categories = Object.keys(QUOTE_DATABASE) as Array<keyof typeof QUOTE_DATABASE>;
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const quotes = QUOTE_DATABASE[randomCategory];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    
    let catDisplayName = "Panic Volatility";
    if (randomCategory === 'popCultureMovies') catDisplayName = "Pop Culture Movies";
    if (randomCategory === 'tradingPsychology') catDisplayName = "Trading Psychology";
    if (randomCategory === 'cryptoMemes') catDisplayName = "Crypto Memes";

    setActiveQuote({
      text: randomQuote.text,
      author: 'author' in randomQuote ? randomQuote.author : undefined,
      category: catDisplayName
    });

    quoteTimeoutRef.current = setTimeout(() => {
      setActiveQuote(null);
    }, 7000);
  };

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Enum and helper for Firestore permission checks compliant with system-skills rules
  enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }

  interface FirestoreErrorInfo {
    error: string;
    operationType: OperationType;
    path: string | null;
    authInfo: {
      userId?: string | null;
      email?: string | null;
      emailVerified?: boolean | null;
      isAnonymous?: boolean | null;
      tenantId?: string | null;
      providerInfo?: {
        providerId?: string | null;
        email?: string | null;
      }[];
    }
  }

  const handleLocalFirestoreError = (error: unknown, operationType: OperationType, path: string | null, user: FirebaseUser | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: user?.uid || null,
        email: user?.email || null,
        emailVerified: user?.emailVerified || null,
        isAnonymous: user?.isAnonymous || null,
        tenantId: user?.tenantId || null,
        providerInfo: user?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  };

  const preseedSessionsIfEmpty = async (uid: string) => {
    // No-op - default chat sessions pre-seeding removed as requested
  };

  // Real-time listener on the sessions collection
  useEffect(() => {
    if (!currentUser) {
      setPastConversations([]);
      return;
    }

    setLoadingPastConversations(true);

    const q = firestoreQuery(
      collection(db, 'sessions'),
      where('userId', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        setPastConversations([]);
        setLoadingPastConversations(false);
        return;
      }

      const defaultTitles = [
        "Bitcoin EMA & Trend Alignment Check",
        "Solana 15m Scalping Entry Setup",
        "Mantle Token Breakdown Risk Model"
      ];

      const list = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          let tsStr = 'Just now';
          let rawTime = 0;
          if (data.createdAt) {
            try {
              const dt = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt.seconds * 1000);
              tsStr = dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              rawTime = dt.getTime();
            } catch (e) {
              tsStr = 'Recently';
              rawTime = Date.now();
            }
          } else {
            // If createdAt is serverTimestamp() and hasn't been written to local cache yet, put it on top as most recent
            rawTime = Date.now() + 60000;
          }
          return {
            id: doc.id,
            topic: data.title || 'Untitled Session',
            timestamp: tsStr,
            indicators: [],
            messages: data.messages || [],
            rawTime
          };
        })
        .filter(item => !defaultTitles.includes(item.topic));

      // Sort client-side descending to prevent missing-index exceptions
      const sortedList = [...list].sort((a, b) => b.rawTime - a.rawTime);

      setPastConversations(sortedList);
      setLoadingPastConversations(false);
    }, (error: any) => {
      console.error("Error listening to sessions:", error);
      try {
        handleLocalFirestoreError(error, OperationType.LIST, 'sessions', currentUser);
      } catch (e) {
        // Handled silently to avoid crashing UI thread
      }
      setLoadingPastConversations(false);
    });

    return () => {
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (e) {}
      }
    };
  }, [currentUser]);

  // Track authentication session
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
        setCurrentPage('dashboard');
      } else {
        setPastConversations([]);
        setActiveSessionId(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Authentication error:', err);
      setAuthError(err.message || String(err));
    }
  };
  
  // Modals state
  const [showStrategiesModal, setShowStrategiesModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentUser) {
      setProfileError('No authenticated user found.');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setProfileError('Please select a valid image file.');
      return;
    }

    setIsUpdatingProfile(true);
    setProfileError(null);

    try {
      const storageRef = ref(storage, `avatars/${currentUser.uid}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      await updateProfile(currentUser, { photoURL: downloadURL });
      
      // Force immediate local UI state update of the user object
      const refreshedUser = Object.assign(Object.create(Object.getPrototypeOf(currentUser)), currentUser, {
        photoURL: downloadURL
      });
      setCurrentUser(refreshedUser);
    } catch (err: any) {
      console.error('Failed to change avatar:', err);
      setProfileError(err.message || String(err));
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // States from original implementation
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStatusText, setIngestStatusText] = useState<string>('');
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestSuccess, setIngestSuccess] = useState<any | null>(null);
  const [strategiesList, setStrategiesList] = useState<TradingStrategy[]>([]);
  const [loadingStrategiesList, setLoadingStrategiesList] = useState(false);
  const [curatedStrategies, setCuratedStrategies] = useState<any[]>([]);
  const [loadingCurated, setLoadingCurated] = useState(false);

  // Chat-related states
  const [query, setQuery] = useState('');
  const [attachedImage, setAttachedImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [isDrawingOpen, setIsDrawingOpen] = useState(false);
  
  // Computed URL representation of attached image
  const attachedImageUrl = attachedImage ? `data:${attachedImage.mimeType};base64,${attachedImage.data}` : null;
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  
  // Custom conversational tracking
  const [conversationStarted, setConversationStarted] = useState(false);

  // Past conversations list populated dynamically from Firestore
  const [pastConversations, setPastConversations] = useState<ConversationHistory[]>([]);
  const [loadingPastConversations, setLoadingPastConversations] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCancelQuery = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsQuerying(false);
    
    const cancelMsg: ChatMessage = {
      id: `cancel-${Date.now()}`,
      sender: 'bot',
      text: `⛔ **Analysis Interrupted:** Request stopped by user.`,
      timestamp: formatMessageTime()
    };
    setChatHistory(prev => [...prev, cancelMsg]);
  };

  // Dynamic automatic scroll to bottom of chat feed
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isQuerying]);

  // Fetch compiled strategies from backend on mount
  const fetchStrategies = async (userId?: string) => {
    setLoadingStrategiesList(true);
    try {
      const url = userId ? `/api/strategies?userId=${userId}` : '/api/strategies';
      const response = await fetch(url);
      const data = await response.json();
      if (data.success && data.strategies) {
        setStrategiesList(data.strategies);
      }
    } catch (e) {
      console.warn('Failed to load strategies list', e);
    } finally {
      setLoadingStrategiesList(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchStrategies(currentUser.uid);
    } else {
      fetchStrategies();
    }
  }, [currentUser]);

  // Synchronize curated strategies from global_strategies collection
  useEffect(() => {
    if (!currentUser) {
      setCuratedStrategies([]);
      return;
    }
    setLoadingCurated(true);
    try {
      const globalCol = collection(db, 'global_strategies');
      const q = firestoreQuery(globalCol, limit(15));
      const unsub = onSnapshot(q, (snapshot) => {
        const list = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCuratedStrategies(list);
        setLoadingCurated(false);
      }, (err) => {
        console.warn("[Dashboard] Error loading global_strategies:", err);
        setLoadingCurated(false);
      });
      return () => unsub();
    } catch (e) {
      console.warn("Could not setup curated strategies listener:", e);
      setLoadingCurated(false);
    }
  }, [currentUser]);

  // Sync state behavior of theme to document root helper
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
  }, [theme]);

  // Image screenshot uploads using the robust FileReader helper
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const resolved = await encodeFileToInlineData(file);
      setAttachedImage({
        mimeType: resolved.inlineData.mimeType,
        data: resolved.inlineData.data
      });
    } catch (err) {
      console.error("Error reading and encoding uploaded file:", err);
      setAttachedImage(null);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  // YouTube Ingestion Flow
  const handleIngest = async (urlToProcess?: string) => {
    const targetUrl = urlToProcess || youtubeUrl;
    if (!targetUrl) return;

    setIsIngesting(true);
    setIngestError(null);
    setIngestSuccess(null);
    setIngestStatusText("Extracting Transcript...");

    const timer1 = setTimeout(() => {
      setIngestStatusText("Compiling Strategy JSON...");
    }, 2500);

    const timer2 = setTimeout(() => {
      setIngestStatusText("Saving Parameters to Firestore...");
    }, 5500);

    try {
      const response = await fetch('/api/rag/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          youtubeUrl: targetUrl,
          userId: currentUser?.uid 
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Failed to ingest strategy tutorial.');
      }

      // Rebuilt Admin Pipeline: Write parsed strategies directly from the authenticated Admin UI context
      try {
        const isPlaylist = targetUrl.includes('list=');
        if (isPlaylist && Array.isArray(data.strategies)) {
          for (const item of data.strategies) {
            await addDoc(collection(db, 'global_strategies'), {
              title: item.title || "Curated Video Strategy",
              strategyData: item.strategyData || [],
              createdAt: serverTimestamp()
            });
          }
        } else if (Array.isArray(data.strategies)) {
          const title = data.strategies[0]?.strategyName || "Curated Video Strategy";
          await addDoc(collection(db, 'global_strategies'), {
            title,
            strategyData: data.strategies,
            createdAt: serverTimestamp()
          });
        }
      } catch (error) {
        console.error("Admin DB Write Error:", error);
      }

      clearTimeout(timer1);
      clearTimeout(timer2);
      setIngestStatusText("Saved to Firestore!");
      setIngestSuccess(data);
      if (!urlToProcess) setYoutubeUrl('');
      
      // Update our stored strategies panel
      await fetchStrategies(currentUser?.uid);
    } catch (err: any) {
      console.error(err);
      clearTimeout(timer1);
      clearTimeout(timer2);
      setIngestStatusText("Process Interrupted");
      setIngestError(err.message || String(err));
    } finally {
      setIsIngesting(false);
    }
  };

  // Send Chat message
  const handleSendMessage = async (customQuery?: string) => {
    const targetQuery = customQuery || query || (attachedImage ? "Evaluate the attached chart screenshot against my loaded strategies." : "");
    if (!targetQuery) return;

    // State Capture Pre-Flight: Capture active session ID and chat history before any await calls
    const capturedSessionId = activeSessionId;
    const capturedChatHistory = [...chatHistory];

    // Slide and hide greeting screen immediately
    setConversationStarted(true);

    const userMsgId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text: targetQuery,
      timestamp: formatMessageTime(),
      image: attachedImageUrl || undefined
    };

    const updatedHistory = [...capturedChatHistory, userMsg];
    setChatHistory(prev => [...prev, userMsg]);
    setQuery('');
    setAttachedImage(null);
    setIsQuerying(true);
    setQueryError(null);

    // Setup active AbortController for cancellation
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ 
          query: targetQuery,
          message: targetQuery,
          maxChunks: 3,
          history: updatedHistory,
          image: attachedImage ? {
            data: attachedImage.data,
            mimeType: attachedImage.mimeType
          } : null
        })
      });

      let data;
      if (!response.ok) {
        // Log the raw text response *before* attempting to parse as JSON to diagnose the issue
        const rawText = await response.text();
        console.error(`[API error response] Server returned non-ok status: ${response.status}`, rawText);
        let errorDetails = 'Failed to trigger Analyst model.';
        try {
          const parsed = JSON.parse(rawText);
          errorDetails = parsed.details || parsed.error || errorDetails;
        } catch (parseError) {
          // If the server returns HTML instead of JSON:
          errorDetails = `Server Error (status ${response.status}): ${rawText.substring(0, 160)}${rawText.length > 160 ? '...' : ''}`;
        }
        throw new Error(errorDetails);
      }

      data = await response.json();

      const analystMsg: ChatMessage = {
        id: `analyst-${Date.now()}`,
        sender: 'bot',
        text: data.answer,
        coinData: data.coinData,
        strategiesUsed: data.strategiesUsed,
        timestamp: formatMessageTime()
      };

      if (isMountedRef.current) {
        setChatHistory(prev => [...prev, analystMsg]);
      }

      if (currentUser) {
        // Strip any undefined keys recursively so Firestore doesn't reject the payload
        const finalHistory = JSON.parse(JSON.stringify([...updatedHistory, analystMsg]));
        (async () => {
          if (capturedSessionId) {
            try {
              const docRef = doc(db, 'sessions', capturedSessionId);
              const existingSession = pastConversations.find(c => c.id === capturedSessionId);
              const topic = existingSession ? existingSession.topic : (targetQuery.length > 34 ? `${targetQuery.substring(0, 34)}...` : targetQuery);
              await updateDoc(docRef, {
                userId: currentUser.uid,
                messages: finalHistory,
                createdAt: serverTimestamp(),
                title: topic
              });
            } catch (error) {
              console.error("Session DB Write Error:", error);
              try {
                handleLocalFirestoreError(error, OperationType.UPDATE, `sessions/${capturedSessionId}`, currentUser);
              } catch (x) {}
            }
          } else {
            try {
              const topic = targetQuery.length > 34 ? `${targetQuery.substring(0, 34)}...` : targetQuery;
              const docRef = await addDoc(collection(db, 'sessions'), {
                userId: currentUser.uid,
                messages: finalHistory,
                createdAt: serverTimestamp(),
                title: topic
              });
              if (isMountedRef.current) {
                setActiveSessionId(docRef.id);
              }
            } catch (error) {
              console.error("Session DB Write Error:", error);
              try {
                handleLocalFirestoreError(error, OperationType.CREATE, 'sessions', currentUser);
              } catch (x) {}
            }
          }
        })();
      } else {
        const topic = targetQuery.length > 34 ? `${targetQuery.substring(0, 34)}...` : targetQuery;
        if (isMountedRef.current) {
          setPastConversations(prev => [
            {
              id: `session-${Date.now()}`,
              topic,
              timestamp: "Just now",
              indicators: [],
              messages: [...updatedHistory, analystMsg]
            },
            ...prev
          ]);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log("Analysis request successfully aborted.");
        return; // handleCancelQuery already pushed the cancellation bubble to the UI
      }
      console.error(err);
      if (isMountedRef.current) {
        setQueryError(err.message || String(err));
        
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          sender: 'bot',
          text: `⚠️ **Analyst Execution Failure:** ${err.message || "The platform's server failed to parse the request rules. Please ensure Firestore is initialized."}`,
          timestamp: formatMessageTime()
        };
        setChatHistory(prev => [...prev, errorMsg]);
      }
    } finally {
      if (isMountedRef.current) {
        setIsQuerying(false);
      }
      if (abortControllerRef.current?.signal.aborted === false) {
        abortControllerRef.current = null;
      }
    }
  };

  // Load past conversation back into active board
  const loadPastConversation = (conv: ConversationHistory) => {
    setActiveSessionId(conv.id);
    setChatHistory(conv.messages);
    setConversationStarted(true);
    setCurrentPage('chat');
  };

  const handleDeleteGlobalStrategy = async (id: string) => {
    try {
      const docRef = doc(db, 'global_strategies', id);
      await deleteDoc(docRef);
    } catch (e) {
      console.error("Failed to delete curated global strategy:", e);
    }
  };

  // Resets chat board to standard empty greeting
  const handleNewChat = () => {
    setActiveSessionId(null);
    setChatHistory([]);
    setConversationStarted(false);
    setCurrentPage('chat');
  };

  // Theme support helpers
  const glassBg = 'bg-[var(--color-card)]/75 border-[var(--color-border)] backdrop-blur-xl';

  const cardBg = 'bg-[var(--color-card)] border-[var(--color-border)] shadow-md';

  const textColor = 'text-[var(--color-text)]';
  const subtextColor = 'text-[var(--color-subtext)]';

  if (authLoading) {
    return (
      <div className="h-screen w-screen relative flex items-center justify-center bg-[var(--color-bg)] select-none text-[var(--color-text)]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-[#F95C4B]" />
          <p className="font-mono text-xs text-[var(--color-subtext)] uppercase tracking-widest font-black">Initializing Boeki Secure Auth...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="h-screen w-screen relative flex flex-col justify-between bg-[var(--color-bg)] overflow-hidden select-none font-sans">
        
        {/* TOP HALF (Branding & Sleek molded 3D Faceted Polyhedron Graphic) */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative w-full min-h-0">
          
          {/* Boeki Logo & Heading */}
          <div className="text-center mb-6 flex flex-col items-center shrink-0">
            {/* Boeki SVG Icon inside a small sleek container */}
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-card)] border border-[var(--color-border)] flex items-center justify-center shadow-md mb-2">
              <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8">
                <path d="M 28.5,48.5 L 47,37.5 L 73.5,45" fill="none" stroke="#000000" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                <path 
                  d="M 51,47 L 51,36.5 Q 51,34.5 53,35 L 59.5,37 Q 61,37.5 61,38.5 L 61,39.5 L 67.5,41.5 Q 69,42 69,43.5 L 69,49 Z" 
                  fill="var(--color-card)" 
                  stroke="#000000" 
                  strokeWidth={2} 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 35,52 L 35,28 Q 35,24.5 37.5,25.2 L 47,27.8 Q 49,28.3 49,30.3 L 49.5,32 L 59,34.7 Q 60.5,35.1 60.5,37 L 60.5,52 Z" 
                  fill="#FFFFFF" 
                  stroke="#000000" 
                  strokeWidth={2} 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 33,55 L 33,38 Q 33,35 35,35.5 L 42.5,37.6 Q 44,38 44,39.5 L 44,41 L 55,44 Q 56.5,44.4 56.5,46 L 56.5,55 Z" 
                  fill="var(--color-card)" 
                  stroke="#000000" 
                  strokeWidth={2} 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 30,59 L 30,41.5 Q 30,38.5 32,39 L 39,41 Q 41,41.5 41,43.5 L 41,44.5 L 52,47.5 Q 53.5,48 53.5,49.5 L 53.5,59 Z" 
                  fill="var(--color-card)" 
                  stroke="#000000" 
                  strokeWidth={2} 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 55,56 L 73.5,45 L 73.5,64.5 L 55,76 Z" 
                  fill="#F95C4B" 
                  stroke="#000000" 
                  strokeWidth={2} 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 28.5,48.5 L 55,56 L 55,76 L 28.5,68.5 Z" 
                  fill="#FFFFFF" 
                  stroke="#000000" 
                  strokeWidth={2} 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 36.5,58 L 44.5,60.2 C 46.5,60.8 46.5,63.2 44.5,63.8 L 36.5,61.6 C 34.5,61 34.5,58.6 36.5,58 Z" 
                  fill="#000000" 
                  stroke="#000000" 
                  strokeWidth={1} 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
              </svg>
            </div>
            
            <h1 className="text-3xl font-sans font-black tracking-tight text-[var(--color-text)] leading-none">
              Boeki
            </h1>
            <span className="text-[10px] font-mono text-[var(--color-subtext)] uppercase tracking-widest mt-1.5 font-bold">
              Quantitative Algorithmic Engine
            </span>
          </div>

          {/* Faceted poly 3D graphic representing AI trading */}
          <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center relative my-auto min-h-0">
            <svg viewBox="0 0 200 200" className="w-full h-full filter drop-shadow-[0_12px_20px_rgba(0,0,0,0.12)] animate-bounce" style={{ animationDuration: '6s' }}>
              <defs>
                <linearGradient id="facet-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#F6F4F1" stopOpacity="0.3" />
                </linearGradient>
                <linearGradient id="facet-grad-2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#E1E5AC" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#C9D085" stopOpacity="0.4" />
                </linearGradient>
                <linearGradient id="facet-grad-3" x1="50%" y1="100%" x2="50%" y2="0%">
                  <stop offset="0%" stopColor="#F95C4B" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#FC8173" stopOpacity="0.5" />
                </linearGradient>
                <linearGradient id="facet-grad-4" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#1E1E1E" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#404040" stopOpacity="0.4" />
                </linearGradient>
                <radialGradient id="glow-grad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#F95C4B" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#F95C4B" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Glowing Background Glow */}
              <circle cx="100" cy="115" r="55" fill="none" stroke="url(#glow-grad)" strokeWidth="30" className="opacity-70" />

              {/* Vector 3D Molded Faceted Polyhedron Crystal */}
              {/* Back Facets */}
              <polygon points="100,20 60,95 100,115" fill="url(#facet-grad-4)" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
              <polygon points="100,20 140,95 100,115" fill="#2E2E2E" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
              
              {/* Bottom Cap Facets */}
              <polygon points="60,95 100,115 100,180" fill="url(#facet-grad-3)" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
              <polygon points="140,95 100,115 100,180" fill="#D83E2D" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
              <polygon points="60,95 35,115 100,180" fill="#C53222" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
              <polygon points="140,95 165,115 100,180" fill="#FF705F" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />

              {/* Left Wing Facets */}
              <polygon points="100,20 60,95 35,115" fill="url(#facet-grad-2)" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
              <polygon points="35,115 60,95 100,115" fill="#AEB476" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />

              {/* Right Wing Facets */}
              <polygon points="100,20 140,95 165,115" fill="#9DA36A" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
              <polygon points="165,115 140,95 100,115" fill="#E2E7BD" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />

              {/* Front Facet Reflection */}
              <polygon points="100,20 100,115 102,113" fill="url(#facet-grad-1)" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />

              {/* Orbiting Quantum Rings */}
              <ellipse cx="100" cy="115" rx="75" ry="25" fill="none" stroke="#F95C4B" strokeWidth="2" strokeDasharray="8 6" className="animate-spin" style={{ animationDuration: '10s' }} />
              <ellipse cx="100" cy="115" rx="85" ry="18" fill="none" stroke="#000000" strokeWidth="1" strokeDasharray="15 8" className="animate-spin opacity-40 animate-reverse" style={{ animationDuration: '16s' }} />
            </svg>
          </div>
        </div>

        {/* BOTTOM HALF (Action Sheet stark white container pulling up over canvas) */}
        <motion.div 
          initial={{ y: 220, opacity: 0.8 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="bg-[var(--color-card)] w-full max-w-md mx-auto relative flex flex-col pt-12 pb-16 px-8 shadow-[0_-16px_36px_rgba(0,0,0,0.5)] shrink-0 select-none border-t border-[var(--color-border)]"
          style={{ 
            borderTopLeftRadius: '32px', 
            borderTopRightRadius: '32px',
          }}
        >
          {/* Subtle grab bar indicator */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 w-12 h-1 bg-[var(--color-border)] rounded-full"></div>

          {/* Clean Sign-in title header with generous padding */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-sans font-extrabold text-[var(--color-text)] tracking-tight leading-none mb-2">
              Sign in to get started
            </h2>
            <p className="text-[10px] font-mono text-[var(--color-subtext)] uppercase tracking-widest font-extrabold mt-1">
              Select connected cloud credential provider
            </p>
          </div>

          <div className="space-y-4 w-full">
            {/* Chunky full-width White Pill Google Button (min-height: 60px) with drop shadow */}
            <button
              onClick={handleGoogleSignIn}
              className="w-full h-[60px] min-h-[60px] rounded-full bg-zinc-900 hover:bg-zinc-800/80 active:scale-98 transition-all flex items-center justify-center gap-4 text-sm font-semibold text-[var(--color-text)] tracking-tight shadow-md border border-[var(--color-border)] cursor-pointer select-none font-sans"
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
              </svg>
              <span>Sign in with Google</span>
            </button>

            {authError && (
              <p className="text-center text-red-500 font-mono text-[10px] leading-relaxed max-w-xs mx-auto uppercase font-black tracking-wide bg-red-50/50 p-3 rounded-xl border border-red-500/10 mt-4">
                Authentication Interrupted:<br />
                {authError}
              </p>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-[var(--color-border)] text-center">
            <span className="text-[9px] font-mono text-[var(--color-subtext)] tracking-widest uppercase font-black block">
              Secure Attribute Access Verification
            </span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative flex flex-col overflow-hidden select-none bg-[var(--color-bg)] text-[var(--color-text)] theme-transition">
      
      {/* Animated Easter Egg Quote Toast */}
      <AnimatePresence>
        {activeQuote && (
          <motion.div
            id="easter-egg-quote-toast"
            initial={{ opacity: 0, y: -80, x: "-50%", scale: 0.95 }}
            animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: -40, x: "-50%", scale: 0.95 }}
            transition={{ type: "spring", stiffness: 350, damping: 24 }}
            className="fixed top-6 left-1/2 z-[99999] w-[85%] max-w-sm bg-[var(--color-card)] border-2 border-[#F95C4B] rounded-2xl shadow-xl p-3.5 select-none text-[var(--color-text)] overflow-hidden"
          >
            {/* Decorative colored top-edge line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-[#F95C4B]" />
            
            <div className="flex items-center gap-3">
              {/* App Logo nested inside quote bubbles */}
              <div className="w-10 h-10 shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-10 h-10">
                  {/* Inner back edges defining container opening */}
                  <path d="M 28.5,48.5 L 47,37.5 L 73.5,45" fill="none" stroke="#000000" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

                  {/* Folder 1 (Back right - Sage Green) */}
                  <path 
                    d="M 51,47 L 51,36.5 Q 51,34.5 53,35 L 59.5,37 Q 61,37.5 61,38.5 L 61,39.5 L 67.5,41.5 Q 69,42 69,43.5 L 69,49 Z" 
                    fill="#E1E5AC" 
                    stroke="#000000" 
                    strokeWidth={2} 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />

                  {/* Folder 2 (Standing White Folder) */}
                  <path 
                    d="M 35,52 L 35,28 Q 35,24.5 37.5,25.2 L 47,27.8 Q 49,28.3 49,30.3 L 49.5,32 L 59,34.7 Q 60.5,35.1 60.5,37 L 60.5,52 Z" 
                    fill="#FFFFFF" 
                    stroke="#000000" 
                    strokeWidth={2} 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />

                  {/* Folder 3 (Middle-left - Warm Neutral) */}
                  <path 
                    d="M 33,55 L 33,38 Q 33,35 35,35.5 L 42.5,37.6 Q 44,38 44,39.5 L 44,41 L 55,44 Q 56.5,44.4 56.5,46 L 56.5,55 Z" 
                    fill="#F6F4F1" 
                    stroke="#000000" 
                    strokeWidth={2} 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />

                  {/* Folder 4 (Front-most - Sage Green) */}
                  <path 
                    d="M 30,59 L 30,41.5 Q 30,38.5 32,39 L 39,41 Q 41,41.5 41,43.5 L 41,44.5 L 52,47.5 Q 53.5,48 53.5,49.5 L 53.5,59 Z" 
                    fill="#E1E5AC" 
                    stroke="#000000" 
                    strokeWidth={2} 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />

                  {/* Coral Right Face */}
                  <path 
                    d="M 55,56 L 73.5,45 L 73.5,64.5 L 55,76 Z" 
                    fill="#F95C4B" 
                    stroke="#000000" 
                    strokeWidth={2} 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />

                  {/* White Front Face */}
                  <path 
                    d="M 28.5,48.5 L 55,56 L 55,76 L 28.5,68.5 Z" 
                    fill="#FFFFFF" 
                    stroke="#000000" 
                    strokeWidth={2} 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />

                  {/* Handle on Front Face */}
                  <path 
                    d="M 36.5,58 L 44.5,60.2 C 46.5,60.8 46.5,63.2 44.5,63.8 L 36.5,61.6 C 34.5,61 34.5,58.6 36.5,58 Z" 
                    fill="#000000" 
                    stroke="#000000" 
                    strokeWidth={1} 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                  />
                </svg>
              </div>
              
              <div className="flex-1 min-w-0 pr-5 py-0.5">
                <p className="font-sans text-[11px] md:text-xs font-semibold text-zinc-800 leading-normal">
                  "{activeQuote.text}"
                </p>
              </div>
            </div>
            
            {/* Close button */}
            <button
              onClick={() => setActiveQuote(null)}
              className="absolute top-2.5 right-2.5 p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer"
              aria-label="Close"
              id="close-quote-toast-btn"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* MAIN CONTAINER */}
      <div className="flex-1 w-full h-full flex flex-col relative z-10 max-w-6xl mx-auto md:px-4">
        
        {/* VIEWPORTS */}
        <AnimatePresence mode="wait">
          {currentPage === 'chat' ? (
            
            // ==========================================
            // PAGE 1: THE ACTIVE CHAT BOARD
            // ==========================================
            <motion.div 
              id="active-chat-board"
              key="page-chat"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 flex flex-col justify-between overflow-hidden relative h-full w-full"
            >
              
              {/* PAGE 1 HEADER */}
              <header className="px-4 md:px-6 py-4 border-b border-[var(--color-border)] shrink-0 select-none safe-pt bg-transparent">
                <div className="flex items-center justify-between w-[94%] sm:w-full mx-auto">
                  <div className="flex items-center gap-3">
                    {/* Top Left: Hamburger Menu Trigger */}
                    <button 
                      id="hamburger-sidebar-toggle"
                      onClick={() => setCurrentPage('dashboard')}
                      className="p-2.5 -ml-2 rounded-xl text-[var(--color-text)] hover:bg-[var(--color-border)] active:scale-95 transition-all cursor-pointer"
                      title="Open Dashboard"
                    >
                      <Menu className="w-5.1 h-5.1" />
                    </button>

                    <div className="relative">
                      {/* Top Left Text: Boeki App name */}
                      <button 
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="flex items-center gap-1.5 text-lg font-sans font-extrabold tracking-tight text-[var(--color-text)] hover:opacity-80 active:scale-95 transition-all text-left"
                      >
                        <span className="text-[var(--color-text)]">Boeki</span>
                        <ChevronDown className="w-4.5 h-4.5 text-[var(--color-subtext)] mt-0.5" />
                      </button>

                      {dropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)}></div>
                          <div className="absolute top-full left-0 mt-2.5 w-52 rounded-2xl bg-[var(--color-card)] border border-[var(--color-border)] p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-top-1">
                            <div className="px-3 py-1.5 text-[9px] font-mono text-[var(--color-subtext)] uppercase tracking-widest border-b border-[var(--color-border)] font-bold">Selected Agent</div>
                            <button 
                              onClick={() => { setDropdownOpen(false); }}
                              className="w-full text-left px-3.5 py-2.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] rounded-xl flex items-center gap-2 mt-1 font-semibold"
                            >
                              <span className="w-2 h-2 rounded-full bg-emerald-550"></span>
                              <span>Boeki Quant Core</span>
                            </button>
                            <button 
                              onClick={() => { setDropdownOpen(false); }}
                              className="w-full text-left px-3.5 py-2.5 text-xs text-[var(--color-text)]/40 hover:bg-[var(--color-border)] rounded-xl flex items-center gap-2 cursor-not-allowed mt-1"
                              disabled
                            >
                              <span className="w-2 h-2 rounded-full bg-black/20"></span>
                              <span>Multi-Agent Mesh (Soon)</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Top Right: Profile badge to maintain layout balance */}
                  <button 
                    onClick={() => setShowProfileModal(true)}
                    title="Profile Management"
                    className="w-8 h-8 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] text-[11px] font-black text-[var(--color-text)] flex items-center justify-center font-mono shadow-sm overflow-hidden shrink-0 cursor-pointer hover:scale-105 hover:border-[var(--color-text)] transition-all duration-200"
                  >
                    {currentUser?.photoURL ? (
                      <img src={currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span>
                        {(currentUser?.displayName || 'Manasseh')[0].toUpperCase()}
                      </span>
                    )}
                  </button>
                </div>
              </header>

              {/* BODY MESSAGES / GREETING CONTAINER */}
              <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 relative flex flex-col w-full h-full">
                
                {/* 1. GREETING EMPTY STATE (CENTER SCREEN) */}
                <AnimatePresence>
                  {!conversationStarted && chatHistory.length === 0 && (
                    <motion.div 
                      id="welcome-greeting-container"
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -20 }}
                      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20 pointer-events-auto"
                    >
                      {/* Chunky Squircle Isometric File Box Logo inspired by image_3.png */}
                      <div className="relative w-20 h-20 flex items-center justify-center mb-6">
                        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-20 h-20">
                          {/* Inner back edges defining container opening */}
                          <path d="M 28.5,48.5 L 47,37.5 L 73.5,45" fill="none" stroke="#000000" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

                          {/* Folder 1 (Back right - Sage Green) */}
                          <path 
                            d="M 51,47 L 51,36.5 Q 51,34.5 53,35 L 59.5,37 Q 61,37.5 61,38.5 L 61,39.5 L 67.5,41.5 Q 69,42 69,43.5 L 69,49 Z" 
                            fill="#E1E5AC" 
                            stroke="#000000" 
                            strokeWidth={2} 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                          />

                          {/* Folder 2 (Standing White Folder) */}
                          <path 
                            d="M 35,52 L 35,28 Q 35,24.5 37.5,25.2 L 47,27.8 Q 49,28.3 49,30.3 L 49.5,32 L 59,34.7 Q 60.5,35.1 60.5,37 L 60.5,52 Z" 
                            fill="#FFFFFF" 
                            stroke="#000000" 
                            strokeWidth={2} 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                          />

                          {/* Folder 3 (Middle-left - Warm Neutral) */}
                          <path 
                            d="M 33,55 L 33,38 Q 33,35 35,35.5 L 42.5,37.6 Q 44,38 44,39.5 L 44,41 L 55,44 Q 56.5,44.4 56.5,46 L 56.5,55 Z" 
                            fill="#F6F4F1" 
                            stroke="#000000" 
                            strokeWidth={2} 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                          />

                          {/* Folder 4 (Front-most - Sage Green) */}
                          <path 
                            d="M 30,59 L 30,41.5 Q 30,38.5 32,39 L 39,41 Q 41,41.5 41,43.5 L 41,44.5 L 52,47.5 Q 53.5,48 53.5,49.5 L 53.5,59 Z" 
                            fill="#E1E5AC" 
                            stroke="#000000" 
                            strokeWidth={2} 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                          />

                          {/* Coral Right Face */}
                          <path 
                            d="M 55,56 L 73.5,45 L 73.5,64.5 L 55,76 Z" 
                            fill="#F95C4B" 
                            stroke="#000000" 
                            strokeWidth={2} 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                          />

                          {/* White Front Face */}
                          <path 
                            d="M 28.5,48.5 L 55,56 L 55,76 L 28.5,68.5 Z" 
                            fill="#FFFFFF" 
                            stroke="#000000" 
                            strokeWidth={2} 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                          />

                          {/* Handle on Front Face */}
                          <path 
                            d="M 36.5,58 L 44.5,60.2 C 46.5,60.8 46.5,63.2 44.5,63.8 L 36.5,61.6 C 34.5,61 34.5,58.6 36.5,58 Z" 
                            fill="#000000" 
                            stroke="#000000" 
                            strokeWidth={1} 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                          />
                        </svg>
                      </div>

                      {/* Display human greeting */}
                      <h1 className="text-xl md:text-2xl font-display font-black text-[var(--color-text)] tracking-tight leading-none mb-3">
                        Ask away, {currentUser?.displayName?.split(' ')[0] || 'Manasseh'}!
                      </h1>
                      <p className="text-[11px] font-mono text-[var(--color-subtext)] max-w-xs leading-relaxed font-bold uppercase tracking-wider">
                        Real-time quantitative trading analysis co-pilot
                      </p>

                      {/* Speed dials fallback helpers - styled using var(--color-badge-bg) tags and var(--color-card) cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md w-full mt-8">
                        <button 
                          onClick={() => handleSendMessage("Analyze Solana trend support setup")}
                          className="p-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl text-left text-[11px] text-[var(--color-text)] hover:opacity-90 transition-all cursor-pointer shadow-md active:scale-98"
                        >
                          <span className="inline-block font-extrabold text-[var(--color-text)] font-mono text-[9px] uppercase tracking-wider mb-1.5 px-2 py-0.5 rounded bg-[var(--color-badge-bg)]">⚡ Dynamic Check</span>
                          <span className="block font-bold">Analyze Solana trend support setup</span>
                        </button>
                        <button 
                          onClick={() => handleSendMessage("Compare my database strategies effectiveness on Bitcoin")}
                          className="p-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl text-left text-[11px] text-[var(--color-text)] hover:opacity-90 transition-all cursor-pointer shadow-md active:scale-98"
                        >
                          <span className="inline-block font-extrabold text-[var(--color-text)] font-mono text-[9px] uppercase tracking-wider mb-1.5 px-2 py-0.5 rounded bg-[var(--color-badge-bg)]">📈 Multi-Strategy Check</span>
                          <span className="block font-bold">Compare database strategies on BTC</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {conversationStarted && (
                  <div className="flex-1 w-full max-w-3xl mx-auto space-y-6 pb-24 pt-2 px-1">
                    {chatHistory.map((message) => {
                      const isBot = message.sender === 'bot';
                      return (
                        <div 
                          key={message.id} 
                          className={`flex flex-col gap-2 w-full ${isBot ? 'items-start' : 'items-end'}`}
                        >
                          {/* Message body (iOS Premium Squircle shape, generous padding, 92-95% edge-to-edge width bounds) */}
                          <div className={`rounded-[2rem] p-5 sm:p-6 text-[13px] sm:text-sm leading-relaxed shadow-md border border-[var(--color-border)] w-[94%] sm:w-auto sm:max-w-[85%] ${
                            isBot 
                              ? 'bg-[var(--color-card)] text-[var(--color-text)]' 
                              : 'bg-[var(--color-bubble)] text-[var(--color-text)]'
                          }`}>
                            
                            {isBot ? (
                              <div className="markdown-body space-y-2.5">
                                <Markdown
                                  components={{
                                    h1: ({node, ...props}) => <h1 className="text-sm font-bold font-mono text-[var(--color-text)] mt-4 mb-2 border-b border-[var(--color-border)] pb-1 uppercase tracking-tight" {...props} />,
                                    h2: ({node, ...props}) => <h2 className="text-xs font-bold font-mono text-[#F95C4B] mt-3 mb-1.5" {...props} />,
                                    h3: ({node, ...props}) => <h3 className="text-xs font-bold font-mono text-[var(--color-subtext)] mt-2 mb-1" {...props} />,
                                    p: ({node, ...props}) => <p className="leading-relaxed mb-3 text-[var(--color-text)]/90 font-medium" {...props} />,
                                    ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-3 space-y-1 text-[var(--color-text)]/90" {...props} />,
                                    ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-3 space-y-1 text-[var(--color-text)]/90" {...props} />,
                                    li: ({node, ...props}) => <li className="text-[12px] sm:text-[12.5px] font-medium" {...props} />,
                                    strong: ({node, ...props}) => <strong className="font-extrabold text-[var(--color-text)]" {...props} />,
                                    code: ({node, className, children, ...props}) => {
                                      const match = /language-(\w+)/.exec(className || '');
                                      const inline = !match;
                                      return inline ? (
                                        <code className="bg-[var(--color-badge-bg)] text-[var(--color-text)] px-1.5 py-0.5 rounded font-mono text-[10.5px]" {...props}>{children}</code>
                                      ) : (
                                        <pre className="bg-[var(--color-bubble)] border border-[var(--color-border)] p-3 rounded-xl font-mono text-[10.5px] text-[var(--color-text)] overflow-x-auto my-3"><code {...props}>{children}</code></pre>
                                      );
                                    }
                                  }}
                                >
                                  {message.text}
                                </Markdown>
                              </div>
                            ) : (
                              <div className="whitespace-pre-wrap font-medium">{message.text}</div>
                            )}

                            {/* Attached Screenshot Image bubble render */}
                            {message.image && (
                              <div className="mt-4 max-w-sm rounded-2xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-bubble)]/60 relative shadow-inner">
                                <img src={message.image} alt="Chart Verification" className="max-h-64 object-contain w-full" referrerPolicy="no-referrer" />
                                <div className="absolute top-2.5 left-2.5 bg-[var(--color-card)]/95 border border-[var(--color-border)] px-2.5 py-1 rounded text-[8px] font-mono text-[var(--color-text)] uppercase tracking-widest font-black shadow">
                                  CHART SCREENSHOT
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Extra Dynamic Coingecko pricing or Aligned strategies indicators */}
                          {isBot && (message.coinData || message.strategiesUsed) && (
                            <div className="w-[94%] sm:w-auto sm:max-w-[85%] grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5 pl-3 border-l-2 border-[var(--color-border)]">
                              {message.coinData && (
                                <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl p-4 flex items-center justify-between shadow-sm">
                                  <div>
                                    <span className="block text-[8px] font-mono text-[var(--color-subtext)] uppercase tracking-widest font-bold">Coingecko Live</span>
                                    <span className="text-[11px] font-black text-[var(--color-text)] mt-1 block">{message.coinData.name} ({message.coinData.symbol})</span>
                                  </div>
                                  <div className="text-right">
                                    <span className="block text-xs font-mono font-bold text-[var(--color-text)]">${message.coinData.priceUsd.toLocaleString()}</span>
                                    <span className={`text-[9px] font-mono font-bold ${
                                      message.coinData.change24h >= 0 ? 'text-emerald-500' : 'text-rose-500'
                                    }`}>
                                      {message.coinData.change24h >= 0 ? '▲ +' : '▼ '}{message.coinData.change24h}%
                                    </span>
                                  </div>
                                </div>
                              )}

                              {message.strategiesUsed && message.strategiesUsed.length > 0 && (
                                <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-3 flex flex-col justify-center gap-1 shadow-sm">
                                  <span className="block text-[8px] font-mono text-[var(--color-subtext)] uppercase tracking-widest">Triggered Setups</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {message.strategiesUsed.map((strat, sIdx) => (
                                      <span 
                                        key={sIdx} 
                                        className="text-[9px] font-mono bg-[var(--color-badge-bg)] border border-[var(--color-border)] text-[var(--color-text)] font-bold px-1.5 py-0.5 rounded truncate max-w-full"
                                        title={strat.strategyName}
                                      >
                                        ⚙️ {strat.strategyName}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Message Meta-Row Below Bubble with Timestamp & Copy Action */}
                          <div className={`flex items-center gap-3 text-[10px] text-[var(--color-subtext)]/60 font-mono mt-1 ${isBot ? 'pl-3 self-start' : 'pr-3 self-end flex-row-reverse'}`}>
                            <span>{message.timestamp}</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(message.text);
                                setCopiedMessageId(message.id);
                                setTimeout(() => setCopiedMessageId(null), 1500);
                              }}
                              className="hover:text-[var(--color-text)] active:scale-95 transition-all p-1 rounded hover:bg-[var(--color-badge-bg)] cursor-pointer flex items-center gap-1 text-[var(--color-subtext)]/85 select-none"
                              title="Copy message to clipboard"
                            >
                              {copiedMessageId === message.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-500 animate-pulse" />
                                  <span className="text-emerald-500 font-bold">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-[var(--color-subtext)]/70" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Query Loading State */}
                    {isQuerying && (
                      <div className="flex flex-col gap-2 w-full items-start">
                        {/* Typing Animation Bubble */}
                        <div className="rounded-[2rem] bg-[var(--color-card)] border border-[var(--color-border)] p-5 text-sm leading-relaxed shadow-md flex items-center gap-1.5 w-[94%] sm:w-auto max-w-[85%] h-[48px] justify-center px-6">
                          <span className="w-2 h-2 rounded-full bg-[var(--color-text)] animate-dot-pulse-1"></span>
                          <span className="w-2 h-2 rounded-full bg-[var(--color-text)] animate-dot-pulse-2"></span>
                          <span className="w-2 h-2 rounded-full bg-[var(--color-text)] animate-dot-pulse-3"></span>
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* DOCK BAR ATTACHMENT AND INPUT PILL (BOTTOM) */}
              <div className="p-4 shrink-0 pointer-events-auto z-30 select-none pb-6">
                <div className="max-w-2xl mx-auto w-full relative">
                  
                  {/* File Pickers */}
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleImageChange} 
                  />

                  {/* Thumbnail snippet of attached image above dock */}
                  <AnimatePresence>
                    {attachedImage && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-full mb-3 left-0 bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-2.5 flex items-center gap-3 shadow-2xl z-40 max-w-md"
                      >
                        <div className="relative rounded-lg overflow-hidden bg-[var(--color-bubble)] w-12 h-10 border border-[var(--color-border)] shrink-0 flex items-center justify-center">
                          <img src={attachedImageUrl || undefined} alt="Attachment thumbnail" className="object-cover w-full h-full" referrerPolicy="no-referrer" />
                          <button 
                            onClick={() => setAttachedImage(null)}
                            className="absolute top-0 right-0 bg-red-600 hover:bg-red-700 p-0.5 rounded-bl text-white transition-colors cursor-pointer"
                            title="Remove attachment"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-[10px] font-mono text-[var(--color-subtext)] flex flex-col gap-1 items-start justify-center">
                          <span className="font-extrabold text-[#F95C4B] block uppercase tracking-wider">CHART SCREENSHOT MOUNTED</span>
                          <span className="mb-1 block">Analyst will check alignment setup layouts</span>
                          <button
                            onClick={() => setIsDrawingOpen(true)}
                            className="px-2 py-0.5 rounded bg-[#F95C4B]/10 border border-[#F95C4B]/20 hover:bg-[#F95C4B]/20 text-[#F95C4B] font-semibold text-[9px] tracking-wider uppercase transition-colors flex items-center gap-1 cursor-pointer"
                            title="Highlight trends or indicators before submitting"
                          >
                            <Palette className="w-2.5 h-2.5" />
                            Highlight / Draw
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {isDrawingOpen && attachedImage && (
                    <DrawingOverlay
                      imageUrl={attachedImageUrl!}
                      mimeType={attachedImage.mimeType}
                      onClose={() => setIsDrawingOpen(false)}
                      onSave={(newBase64) => {
                        setAttachedImage({
                          data: newBase64,
                          mimeType: attachedImage.mimeType
                        });
                        setIsDrawingOpen(false);
                      }}
                    />
                  )}

                  {/* Glassmorphic floating rounded pill-shaped container (The input dock - Chunky, Edge-to-Edge, Safe area aware) */}
                  <div 
                    className="flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-full shadow-xl relative focus-within:border-[var(--color-accent)]/40 transition-all h-[64px] sm:h-[68px] w-[94%] sm:w-full mx-auto safe-mb mb-2"
                    style={{ boxSizing: 'border-box', padding: '8px 24px' }}
                  >
                    
                    {/* Left: Simple '+' icon for attaches */}
                    <button
                      onClick={triggerFileSelect}
                      title="Attach Chart Screenshot"
                      className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[var(--color-badge-bg)] hover:bg-[var(--color-badge-bg)]/80 text-[var(--color-text)] flex items-center justify-center shrink-0 active:scale-95 transition-all cursor-pointer border border-[var(--color-border)] shadow-inner"
                    >
                      <Plus className="w-5 h-5" />
                    </button>

                    {/* Center: Input field with Ask Boeki placeholder */}
                    <input 
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={isQuerying ? "Please wait for Boeki to analyze..." : "Ask Boeki"}
                      disabled={isQuerying}
                      className="flex-1 min-w-0 bg-transparent px-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text)]/40 focus:outline-none border-none py-2 font-sans font-semibold disabled:opacity-50"
                      style={{ minWidth: 0 }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isQuerying && (query.trim() || attachedImage)) {
                          handleSendMessage();
                        }
                      }}
                    />
 
                    {/* Right: Premium, native iOS-style Send button that lightens when text is entered and acts as a "Stop" button when active */}
                    <button
                      type="button"
                      onClick={() => {
                        if (isQuerying) {
                          handleCancelQuery();
                        } else if (query.trim() || attachedImage) {
                          handleSendMessage();
                        }
                      }}
                      disabled={!isQuerying && !query.trim() && !attachedImage}
                      title={isQuerying ? "Stop active analysis request" : "Send message to Boeki"}
                      className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-all cursor-pointer shadow-lg ${
                        isQuerying
                          ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse'
                          : (query.trim() || attachedImage)
                            ? 'bg-[#F95C4B] hover:opacity-95 text-white'
                            : 'bg-[var(--color-badge-bg)] text-[var(--color-text)]/20 cursor-not-allowed'
                      }`}
                    >
                      {isQuerying ? (
                        <div className="w-3.5 h-3.5 bg-white rounded-sm"></div>
                      ) : (
                        <Send className="w-4.5 h-4.5 ml-0.5 text-white" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

            </motion.div>
          ) : currentPage === 'admin' ? (
            // ==========================================
            // PAGE 3: THE ADMIN STRATEGIST CONSOLE
            // ==========================================
            <motion.div 
              id="admin-dashboard-panel"
              key="page-admin"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 flex flex-col overflow-y-auto pb-28 pt-2 px-4 space-y-6 md:p-6 w-full h-full relative"
            >
              
              {/* ADMIN HEADER */}
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-4.5 shrink-0 select-none safe-pt pt-3 w-[94%] sm:w-full mx-auto">
                <div className="flex flex-col">
                  <h1 className="text-2xl font-sans font-black tracking-tight text-[var(--color-text)] leading-none">
                    Admin Strategy Console
                  </h1>
                  <span className="text-[10px] font-mono text-[#F95C4B] uppercase tracking-widest mt-1.5 font-bold">
                    Role-Based Access Control Mode (Admin)
                  </span>
                </div>

                <button 
                  onClick={() => setCurrentPage('dashboard')}
                  className="bg-zinc-850 hover:bg-zinc-800 text-white font-mono font-black text-xs px-4 py-3 rounded-xl transition-all flex items-center gap-2 select-none cursor-pointer border border-[var(--color-border)] shrink-0 shadow"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Exit Console</span>
                </button>
              </div>

              {/* YOUTUBE LINKER INJECTION ZONE (ADMIN CONTAINER - STARK DARK THEME) */}
              <div 
                className="bg-[var(--color-card)] border border-[var(--color-border)] shadow-xl relative flex select-none w-[94%] sm:w-full mx-auto"
                style={{ 
                  borderRadius: '24px', 
                  minHeight: '160px', 
                  height: 'auto', 
                  padding: '24px', 
                  paddingBottom: '32px',
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '16px' 
                }}
              >
                
                {/* Visual light accent glow effect */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#F95C4B]/5 rounded-full blur-[60px] pointer-events-none"></div>

                <div className="flex items-center gap-4.5">
                  <div className="w-12 h-12 rounded-2xl bg-[#F95C4B]/10 border border-[#F95C4B]/20 flex items-center justify-center shrink-0">
                    <Youtube className="w-6 h-6 text-[#F95C4B]" />
                  </div>
                  <div>
                    <h2 className="text-base font-sans font-bold text-[var(--color-text)]">Curated Platform Strategy Linker</h2>
                    <p className="text-[10.5px] text-[var(--color-subtext)] font-mono mt-0.5 leading-relaxed font-semibold">Publish authoritative strategy indexes parsed from premium market tutorials</p>
                  </div>
                </div>

                {/* Link Entry Input Bar */}
                <div className="relative flex items-center bg-zinc-950 border border-[var(--color-border)] rounded-2xl p-1 focus-within:border-[var(--color-accent)]/25 focus-within:ring-2 focus-within:ring-[var(--color-accent)]/10 transition-all shadow-inner h-[48px] w-full">
                  <input 
                    type="text" 
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="Paste global YouTube strategy or playlist URL..." 
                    className="flex-1 bg-transparent pl-4 pr-3 text-xs sm:text-sm font-semibold font-mono text-[var(--color-text)] placeholder:text-[var(--color-subtext)]/40 focus:outline-none h-full leading-relaxed bg-transparent"
                  />
                  <button 
                    onClick={() => handleIngest()}
                    disabled={isIngesting || !youtubeUrl}
                    className="bg-zinc-900 hover:bg-zinc-850 disabled:opacity-45 text-white font-sans font-black text-xs px-4 h-10 rounded-xl transition-all flex items-center justify-center gap-2 select-none cursor-pointer border border-[var(--color-border)] shrink-0 shadow-lg active:scale-98"
                  >
                    {isIngesting ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Sparkles className="w-3.5 h-3.5 text-[#F95C4B]" />}
                    <span>Ingest Global Strategy</span>
                  </button>
                </div>

                {/* ACTIVE PIPELINE PROGRESS TRACKER */}
                {(isIngesting || ingestSuccess || ingestError) && (
                  <div className="mt-2 p-4 bg-zinc-950/60 border border-[var(--color-border)] rounded-2xl flex flex-col gap-3 font-mono text-xs shadow-inner text-[var(--color-text)] relative">
                    
                    <div className="flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2 text-[var(--color-text)] font-extrabold">
                        {isIngesting ? (
                          <Loader2 className="w-3.5 h-3.5 text-[#F95C4B] animate-spin shrink-0" />
                        ) : ingestSuccess ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        )}
                        <span>PIPELINE REGSTATUS:</span>
                      </div>
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border ${
                        ingestSuccess 
                          ? 'bg-emerald-950/30 border-emerald-500/20 text-emerald-400 font-extrabold' 
                          : ingestError 
                            ? 'bg-rose-950/30 border-rose-500/20 text-rose-400 font-extrabold' 
                            : 'bg-zinc-900 border-[var(--color-border)] text-[var(--color-subtext)] animate-pulse'
                      }`}>
                        {ingestStatusText || "Process Active"}
                      </span>
                    </div>

                    {/* Milestones stepper status checkboxes */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 border-t border-[var(--color-border)]">
                      <div className={`p-2 rounded-xl flex items-center gap-2 border ${
                        ingestStatusText.includes("Transcript") 
                          ? 'bg-zinc-900 border-zinc-800 text-[var(--color-text)] font-bold' 
                          : ingestStatusText.includes("JSON") || ingestStatusText.includes("Firestore") || ingestSuccess
                            ? 'bg-zinc-950/20 border-transparent text-zinc-650'
                            : 'bg-transparent border-zinc-800/40 text-zinc-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          ingestStatusText.includes("Transcript") 
                            ? 'bg-[#F95C4B] animate-pulse' 
                            : ingestStatusText.includes("JSON") || ingestStatusText.includes("Firestore") || ingestSuccess
                              ? 'bg-emerald-500'
                              : 'bg-zinc-800'
                        }`} />
                        <span className="text-[10px] font-bold">1. Scrape Webcast</span>
                      </div>

                      <div className={`p-2 rounded-xl flex items-center gap-2 border ${
                        ingestStatusText.includes("JSON") 
                          ? 'bg-zinc-900 border-zinc-800 text-[var(--color-text)] font-bold' 
                          : ingestStatusText.includes("Firestore") || ingestSuccess
                            ? 'bg-zinc-950/20 border-transparent text-zinc-650'
                            : 'bg-transparent border-zinc-800/40 text-zinc-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          ingestStatusText.includes("JSON") 
                            ? 'bg-[#F95C4B] animate-pulse' 
                            : ingestStatusText.includes("Firestore") || ingestSuccess
                              ? 'bg-emerald-500'
                              : 'bg-zinc-800'
                        }`} />
                        <span className="text-[10px] font-bold">2. Extract Schema</span>
                      </div>

                      <div className={`p-2 rounded-xl flex items-center gap-2 border ${
                        ingestStatusText.includes("Firestore") || ingestSuccess
                          ? 'bg-zinc-900 border-emerald-500/10 text-emerald-400 font-bold' 
                          : 'bg-transparent border-zinc-800/45 text-zinc-700'
                      }`}>
                        <div className={`w-2 h-2 rounded-full ${
                          ingestSuccess 
                            ? 'bg-emerald-500' 
                            : ingestStatusText.includes("Firestore")
                              ? 'bg-emerald-400 animate-ping'
                              : 'bg-zinc-800'
                        }`} />
                        <span className="text-[10px] font-bold">3. Public Broadcast</span>
                      </div>
                    </div>

                    {ingestSuccess && (
                      <div className="mt-1 flex items-start gap-2 text-[var(--color-subtext)] border-t border-[var(--color-border)] pt-2 text-[10px] leading-relaxed">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <span>Curated strategy template published! Discovered indicator setups have been successfully written to <strong>global_strategies</strong>.</span>
                      </div>
                    )}

                    {ingestError && (
                      <div className="mt-1 flex items-start gap-2 text-rose-500 border-t border-[var(--color-border)] pt-2 text-[10px] leading-relaxed">
                        <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <span>Ingestion failed: {ingestError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* CURATED LIST WITH MANAGEMENT CONTROLS */}
              <div className="w-[94%] sm:w-full mx-auto space-y-4 pt-4 pb-24">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                  <h3 className="text-xs font-mono font-bold text-[var(--color-subtext)] uppercase tracking-widest font-black">
                    Live Published Global Strategies
                  </h3>
                  <span className="text-[10px] font-mono text-[var(--color-text)] font-semibold uppercase bg-[var(--color-badge-bg)] px-3 py-1 rounded border border-[var(--color-border)] shadow-sm">Count: {curatedStrategies.length}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {curatedStrategies.map((strat) => (
                    <div 
                      key={strat.id}
                      className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all shadow-sm"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] pb-2">
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-sans font-bold text-[var(--color-text)] tracking-tight truncate" title={strat.title}>
                              {strat.title}
                            </h4>
                            <span className="text-[8px] font-mono text-[var(--color-subtext)] uppercase mt-0.5 block truncate">
                              ID: {strat.id}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDeleteGlobalStrategy(strat.id)}
                            className="text-rose-400 hover:text-rose-300 text-xs font-mono font-bold uppercase transition-colors px-2.5 py-1.5 rounded hover:bg-rose-950/20 border border-transparent hover:border-rose-950 shrink-0 ml-2"
                            title="Delete this strategy from the public feed"
                          >
                            Delete
                          </button>
                        </div>
                        <p className="text-[11px] text-[var(--color-text)]/70 mt-3 font-semibold line-clamp-3 leading-relaxed">
                          {strat.strategyData?.[0]?.rawRulesText || "Actionable quantitative setup criteria."}
                        </p>
                      </div>
                    </div>
                  ))}
                  {curatedStrategies.length === 0 && (
                    <div className="col-span-full text-center py-12 text-[var(--color-subtext)] font-mono text-xs bg-[var(--color-badge-bg)] rounded-[2rem] border border-dashed border-[var(--color-border)] px-4">
                      No global curated strategies exist yet.
                    </div>
                  )}
                </div>
              </div>

            </motion.div>
          ) : (
            
            // ==========================================
            // PAGE 2: THE WORKSPACE DASHBOARD
            // ==========================================
            <motion.div 
              id="workspace-dashboard"
              key="page-dashboard"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 flex flex-col overflow-y-auto pb-28 pt-2 px-4 space-y-6 md:p-6 w-full h-full relative"
            >
              
              {/* PAGE 2 HEADER ZONE */}
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-4.5 shrink-0 select-none safe-pt pt-3 w-[94%] sm:w-full mx-auto">
                <div className="flex flex-col">
                  {/* Application Title bold clean typeface (Page 2) */}
                  <h1 className="text-2xl font-sans font-black tracking-tight text-[var(--color-text)] leading-none">
                    Boeki
                  </h1>
                  <span className="text-[10px] font-mono text-[var(--color-subtext)] uppercase tracking-widest mt-1.5 font-bold">
                    Workspace Dashboard
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Easter Egg Quote Generator button replaces Dark Mode toggle */}
                  <button 
                    onClick={triggerQuoteEngine}
                    className="w-12 h-12 rounded-2xl bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)] flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-sm"
                    title="Click for a market wisdom quote! 💡"
                  >
                    <Moon className="w-5 h-5 text-[#F95C4B]" />
                  </button>

                  {/* Profile avatar */}
                  <button 
                    onClick={() => setShowProfileModal(true)}
                    title="Profile Management"
                    className="w-12 h-12 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] flex items-center justify-center text-xs font-bold text-[var(--color-text)] shadow-sm overflow-hidden shrink-0 font-mono cursor-pointer hover:scale-105 hover:border-[var(--color-text)] transition-all duration-200"
                  >
                    {currentUser?.photoURL ? (
                      <img src={currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span title={`${currentUser?.displayName || 'Manasseh'} Profile`}>
                        {(currentUser?.displayName || 'Manasseh')[0].toUpperCase()}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* TWO-COLUMN CURATED PLATFORM MAIN GRID SYSTEM */}
              <div className="flex-grow flex flex-col lg:flex-row gap-8 select-none w-[94%] sm:w-full mx-auto pb-24">
                
                {/* CURATED STRATEGIES FEED (Left or Top) */}
                <div className="flex-1 flex flex-col gap-3.5">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                    <h3 className="text-xs font-mono font-bold text-[var(--color-subtext)] uppercase tracking-widest font-black">
                      Curated Strategies
                    </h3>
                    <span className="text-[10px] font-mono text-[var(--color-text)] font-semibold uppercase bg-[var(--color-badge-bg)] px-2 py-0.5 rounded border border-[var(--color-border)] shadow-sm">Count: {curatedStrategies.length}</span>
                  </div>

                  <div className="space-y-3.5 max-h-[460px] overflow-y-auto pr-1">
                    {loadingCurated ? (
                      <div className="flex items-center justify-center py-12 gap-2 text-[var(--color-subtext)] font-mono text-xs">
                        <Loader2 className="h-4.5 w-4.5 animate-spin" />
                        Fetching Curated Set...
                      </div>
                    ) : curatedStrategies.length === 0 ? (
                      <div className="text-center py-12 text-[var(--color-subtext)] font-mono text-xs bg-[var(--color-card)] rounded-[2rem] border border-dashed border-[var(--color-border)] px-4">
                        No global strategies loaded yet.
                      </div>
                    ) : (
                      curatedStrategies.map((strat) => (
                        <div 
                          key={strat.id}
                          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all shadow-sm hover:border-[var(--color-text)]/20"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] pb-2">
                              <div>
                                <h4 className="text-sm font-sans font-bold text-[var(--color-text)] tracking-tight">
                                  {strat.title}
                                </h4>
                                <span className="text-[8px] font-mono text-[var(--color-subtext)] uppercase font-black tracking-wider mt-1 block">
                                  Curated Global Template
                                </span>
                              </div>
                              <span className="text-[9px] font-mono bg-[#F95C4B]/10 text-[#F95C4B] px-2 py-0.5 rounded tracking-wide font-black uppercase shrink-0">
                                {strat.strategyData?.[0]?.timeframe || "1-hour"}
                              </span>
                            </div>

                            <p className="text-xs text-[var(--color-text)]/80 mt-3 font-semibold leading-relaxed line-clamp-4">
                              {strat.strategyData?.[0]?.rawRulesText || "Actionable quantitative setup criteria."}
                            </p>

                            {strat.strategyData?.[0]?.indicators && (
                              <div className="flex flex-wrap gap-1 mt-3.5">
                                {strat.strategyData[0].indicators.slice(0, 4).map((ind: string, indIdx: number) => (
                                  <span key={indIdx} className="bg-[var(--color-badge-bg)] border border-[var(--color-border)] text-[var(--color-text)] px-2 py-0.5 rounded-full font-mono text-[9px] font-bold">
                                    {ind}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="border-t border-[var(--color-border)] pt-3 flex items-center justify-end">
                            <button
                              onClick={() => {
                                setQuery(`Evaluate setup against curated master strategy "${strat.title}"`);
                                setConversationStarted(true);
                                setCurrentPage('chat');
                              }}
                              className="bg-zinc-800 hover:bg-zinc-700 text-[var(--color-text)] font-mono font-bold text-[10px] uppercase px-4 py-2 rounded-xl transition-all cursor-pointer shadow border border-[var(--color-border)]"
                            >
                              Load Into Chat
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* PAST CONVERSATIONS HISTORY SCROLLABLE CONTAINER (Right or Bottom) */}
                <div className="flex-1 flex flex-col gap-3.5">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
                    <h3 className="text-xs font-mono font-bold text-[var(--color-subtext)] uppercase tracking-widest font-black">
                      Past Conversation History
                    </h3>
                    <span className="text-[10px] font-mono text-[var(--color-text)] font-semibold uppercase bg-[var(--color-badge-bg)] px-2 py-0.5 rounded border border-[var(--color-border)] shadow-sm">Count: {pastConversations.length}</span>
                  </div>

                  <div className="space-y-3.5 max-h-[460px] overflow-y-auto pr-1">
                    {loadingPastConversations ? (
                      <div className="flex items-center justify-center py-12 gap-2 text-[var(--color-subtext)] font-mono text-xs">
                        <Loader2 className="h-4.5 w-4.5 animate-spin" />
                        Retrieving History...
                      </div>
                    ) : pastConversations.length === 0 ? (
                      <div className="text-center py-12 text-[var(--color-subtext)] font-mono text-xs bg-[var(--color-card)] rounded-[2rem] border border-dashed border-[var(--color-border)] px-4">
                        No matching historical logs found.
                      </div>
                    ) : (
                      pastConversations.map((conv) => (
                        <div 
                          key={conv.id}
                          onClick={() => loadPastConversation(conv)}
                          className="group bg-[var(--color-card)] border border-[var(--color-border)] hover:bg-[#27272a]/60 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-all hover:scale-[1.01] active:scale-99 shadow-sm relative overflow-hidden"
                          style={{ padding: '12px 16px' }}
                        >
                          <div className="space-y-0.5 min-w-0 flex-1">
                            {/* Chat Topic Name */}
                            <h4 className="text-[13px] sm:text-sm font-sans font-black text-[var(--color-text)] transition-colors tracking-tight truncate pr-2">
                              {conv.topic}
                            </h4>
                            {/* Timestamp */}
                            <p className="text-[9px] font-mono text-[var(--color-subtext)] uppercase font-bold tracking-wider">
                              {conv.timestamp}
                            </p>
                          </div>

                          {/* Right Action Trigger */}
                          <div className="text-[9.5px] font-mono text-[var(--color-subtext)] group-hover:text-[var(--color-text)] flex items-center gap-1 font-bold transition-colors shrink-0">
                            <span>Open</span>
                            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </div>
                      )))}
                  </div>
                </div>

              </div>

              {/* FLOATING BOTTOM NAVIGATION BAR (Anchored on Viewport bottom with iOS Safe area protection) */}
              <div className="fixed bottom-4 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:max-w-xl z-40 select-none safe-mb">
                <div className="bg-[var(--color-card)]/95 border border-[var(--color-border)] rounded-full p-3 shadow-xl backdrop-blur-md flex items-center justify-between h-[68px] sm:h-[72px]">
                  
                  {/* Left Icon: Saved strategies directory from firestore */}
                  <button 
                    onClick={() => {
                      fetchStrategies(currentUser?.uid);
                      setShowStrategiesModal(true);
                    }}
                    title="Browse Saved Trading Strategies"
                    className="w-12 h-12 rounded-full bg-[var(--color-badge-bg)] text-[var(--color-text)] hover:opacity-80 flex items-center justify-center cursor-pointer active:scale-90 transition-all border border-[var(--color-border)] shrink-0"
                  >
                    <FileText className="w-5 h-5" />
                  </button>

                  {/* Center Element: Wide Pill with definitive vibrant coral #F95C4B background labeled "New Chat" */}
                  <button
                    onClick={handleNewChat}
                    className="flex-1 h-12 rounded-full bg-[#F95C4B] hover:bg-[#F95C4B]/95 active:scale-95 transition-all flex items-center justify-center gap-2 font-mono text-xs font-black text-white uppercase tracking-widest shadow-md cursor-pointer mx-3 justify-center border border-[#F95C4B]/10"
                  >
                    <Sparkles className="w-4 h-4 text-white" />
                    <span>New Chat</span>
                  </button>

                  {/* Right Icon: Apple-style gear / settings icon */}
                  <button 
                    onClick={() => setShowSettingsModal(true)}
                    title="Settings & Diagnostics"
                    className="w-12 h-12 rounded-full bg-[var(--color-badge-bg)] text-[var(--color-text)] hover:opacity-80 flex items-center justify-center cursor-pointer active:scale-90 transition-all border border-[var(--color-border)] shrink-0"
                  >
                    <Settings className="w-5 h-5" />
                  </button>

                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* ==========================================
          MODAL DRAWER: FIRESTORE TRADING STRATEGIES LIBRARY
          ========================================== */}
      <AnimatePresence>
        {showStrategiesModal && (
          <>
            {/* Overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStrategiesModal(false)}
              className="fixed inset-0 bg-black z-50 pointer-events-auto"
            />

            {/* Slide-up active panel card */}
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="fixed bottom-0 left-0 right-0 max-h-[85vh] bg-[var(--color-card)] border-t border-[var(--color-border)] rounded-t-[2.5rem] p-6 z-50 backdrop-blur-md flex flex-col pointer-events-auto max-w-2xl mx-auto shadow-2xl"
            >
              
              {/* Modal header details */}
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-4 mb-4 select-none shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 bg-[#F95C4B]/10 border border-[#F95C4B]/20 rounded-xl flex items-center justify-center">
                    <Database className="w-4 h-4 text-[#F95C4B]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-sans font-black text-[var(--color-text)]">Firestore Strategies Library</h3>
                    <p className="text-[10px] font-mono text-[var(--color-subtext)] leading-none mt-1">Active trading setups loaded from cloud database constraints</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => fetchStrategies(currentUser?.uid)}
                    disabled={loadingStrategiesList}
                    className="p-1.5 rounded-lg text-[var(--color-subtext)] hover:text-[var(--color-text)] hover:bg-[var(--color-badge-bg)] cursor-pointer disabled:opacity-45"
                    title="Reload Collection"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingStrategiesList ? 'animate-spin text-[#F95C4B]' : ''}`} />
                  </button>
                  <button 
                    onClick={() => setShowStrategiesModal(false)}
                    className="p-1.5 rounded-lg text-[var(--color-subtext)] hover:text-[var(--color-text)] hover:bg-[var(--color-badge-bg)] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable grid list */}
              <div className="flex-1 overflow-y-auto space-y-4 pb-12 select-none">
                {loadingStrategiesList ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 className="w-8 h-8 text-[#F95C4B] animate-spin" />
                    <span className="font-mono text-xs text-[var(--color-subtext)]">Retrieving Cloud Database Records...</span>
                  </div>
                ) : strategiesList.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {strategiesList.map((strat, idx) => (
                      <div 
                        key={strat.id || idx} 
                        className="bg-zinc-950/40 border border-[var(--color-border)] hover:border-[#F95C4B]/20 rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all shadow-sm"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] pb-2">
                            <div>
                              <span className="block text-xs font-black text-[var(--color-text)] uppercase tracking-tight truncate max-w-[160px]" title={strat.strategyName}>
                                📈 {strat.strategyName}
                              </span>
                              <span className="text-[8px] font-mono text-[var(--color-subtext)] uppercase font-black tracking-wider mt-1 block">
                                ID: #{strat.id?.substring(0, 8) || `db-item-${idx}`}
                              </span>
                            </div>
                            <span className="text-[9px] font-mono bg-[var(--color-badge-bg)] border border-[var(--color-border)] text-[var(--color-text)] px-2 py-0.5 rounded tracking-wide font-black uppercase">
                              {strat.timeframe}
                            </span>
                          </div>

                          <div className="space-y-2.5 text-[11px] text-[var(--color-text)]/80">
                            <div>
                              <span className="block text-[8px] font-mono uppercase text-[var(--color-subtext)] tracking-wider font-black">Active indicators used</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {strat.indicators?.map((ind, indIdx) => (
                                  <span key={indIdx} className="bg-zinc-950 border border-[var(--color-border)] text-[var(--color-text)] px-1.5 py-0.5 rounded font-mono text-[9px] font-bold">
                                    {ind}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {(strat.entryConditions || strat.entryConditionsLong || strat.entryConditionsShort) && (
                              <div>
                                <span className="block text-[8px] font-mono uppercase text-[var(--color-subtext)] tracking-wider font-black">Entry Setup Formulations</span>
                                <p className="font-sans text-[var(--color-text)]/80 mt-1 leading-normal font-semibold whitespace-pre-wrap">
                                  {strat.entryConditions || (
                                    <>
                                      {strat.entryConditionsLong && <span className="block mb-1">🟢 <strong>Long:</strong> {strat.entryConditionsLong}</span>}
                                      {strat.entryConditionsShort && <span className="block">🔴 <strong>Short:</strong> {strat.entryConditionsShort}</span>}
                                    </>
                                  )}
                                </p>
                              </div>
                            )}

                            <div>
                              <span className="block text-[8px] font-mono uppercase text-[var(--color-subtext)] tracking-wider font-black">Target exit variables</span>
                              <p className="font-sans text-[var(--color-text)]/70 mt-0.5 leading-normal font-semibold">{strat.exitConditions}</p>
                            </div>
                          </div>
                        </div>

                        {/* trigger setup into chat feed */}
                        <div className="border-t border-[var(--color-border)] pt-2.5 flex items-center justify-between">
                          <span className="text-[8px] font-mono text-[var(--color-subtext)] tracking-wide uppercase truncate max-w-[110px]" title={strat.videoUrl}>
                            Source: YouTube Linker
                          </span>
                          <button
                            onClick={() => {
                              // Auto draft alignment evaluations
                              setQuery(`Evaluate Ethereum using my saved strategy rules for "${strat.strategyName}"`);
                              setConversationStarted(true);
                              setShowStrategiesModal(false);
                              setCurrentPage('chat');
                            }}
                            className="bg-[#F95C4B] hover:bg-[#F95C4B]/95 text-white font-mono font-black text-[9px] uppercase px-3.5 py-2 rounded-xl transition-all cursor-pointer shadow border border-[#F95C4B]/10"
                          >
                            Trigger Model Check
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-16 text-center text-[var(--color-subtext)] flex flex-col items-center gap-3">
                    <Database className="w-10 h-10 text-[var(--color-subtext)]/20" />
                    <span className="font-mono text-xs uppercase text-[var(--color-text)] select-text block font-black">No Custom Parameters Saved</span>
                    <p className="text-[11px] max-w-xs mx-auto leading-relaxed text-[var(--color-subtext)]">
                      Go link video strategy walk-throughs in the YouTube Strategy Linker above to seed cloud layout rules dynamically.
                    </p>
                  </div>
                )}
              </div>

            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ==========================================
          MODAL: GENERAL SETTINGS & DIAGNOSTIC SYSTEM
          ========================================== */}
      <AnimatePresence>
        {showSettingsModal && (
          <>
            {/* Overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettingsModal(false)}
              className="fixed inset-0 bg-black z-50 pointer-events-auto"
            />

            {/* Slide-over cards container */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-[2rem] p-6 max-w-sm w-full mx-auto z-50 backdrop-blur-md shadow-2xl select-none pointer-events-auto"
            >
              
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3.5 mb-4">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-[#F95C4B]" />
                  <span className="font-sans font-black text-[var(--color-text)] text-[14px]">System Integrity & Setup</span>
                </div>
                <button 
                  onClick={() => setShowSettingsModal(false)}
                  className="p-1 rounded text-[var(--color-subtext)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Integrity status checkers */}
              <div className="space-y-4">
                <div className="p-3.5 bg-zinc-950/40 border border-[var(--color-border)] rounded-2xl space-y-2.5">
                  <span className="text-[8px] font-mono text-[var(--color-subtext)] uppercase tracking-widest block font-black mb-1">Database & AI Connectivity</span>
                  
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--color-text)]/70 font-sans font-bold">Firestore Sync:</span>
                    <span className="text-emerald-400 font-mono font-black flex items-center gap-1.5 uppercase">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0"></span> Connected
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--color-text)]/70 font-sans font-bold">Gemini Version:</span>
                    <span className="text-[var(--color-text)] font-mono font-black flex items-center gap-1.5 uppercase">
                      <span className="w-1.5 h-1.5 bg-[#F95C4B] rounded-full animate-pulse shrink-0"></span> Gemini 2.5 Flash
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--color-text)]/70 font-sans font-bold">Active Ingested Strategies:</span>
                    <span className="text-[var(--color-text)] font-mono font-black uppercase">{strategiesList.length} Items</span>
                  </div>
                </div>

                <div className="p-3.5 bg-zinc-950/40 border border-[var(--color-border)] rounded-2xl space-y-2 text-[10.5px] leading-relaxed text-[var(--color-text)]/70 select-text">
                  <span className="text-[8px] font-mono text-[#F95C4B] uppercase tracking-widest block font-black mb-1">User Identity Registry</span>
                  <div>
                    <span className="text-[var(--color-text)]/40 font-mono font-bold">Trader ID:</span> <span className="text-[var(--color-text)] font-bold">{currentUser?.displayName || 'Manasseh'}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text)]/40 font-mono font-bold">Connected Mail:</span> <span className="text-[var(--color-text)] font-semibold underline">{currentUser?.email || 'kuskomanass@gmail.com'}</span>
                  </div>
                </div>

                {currentUser?.uid === 'JFWUyAe7nxeoyhooaPtTH3eEFWE3' && (
                  <button 
                    onClick={() => {
                      setCurrentPage('admin');
                      setShowSettingsModal(false);
                    }}
                    className="w-full py-2.5 bg-rose-700 hover:bg-rose-800 text-white font-mono font-black text-[9px] tracking-widest uppercase rounded-xl transition-all active:scale-95 cursor-pointer shadow border border-rose-800 flex items-center justify-center gap-1.5"
                  >
                    <Settings className="w-3.5 h-3.5 text-white" />
                    Enter Admin Dashboard
                  </button>
                )}

                <button 
                  onClick={async () => {
                    await signOut(auth);
                    setShowSettingsModal(false);
                  }}
                  className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-mono font-black text-[9px] tracking-widest uppercase rounded-xl transition-all active:scale-95 cursor-pointer shadow border border-[var(--color-border)] flex items-center justify-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5 text-white" />
                  Sign Out of Account
                </button>

                <button 
                  onClick={() => {
                    handleNewChat();
                    setShowSettingsModal(false);
                  }}
                  className="w-full py-3 bg-[#F95C4B] hover:bg-[#F95C4B]/95 text-white font-mono font-black text-[10px] tracking-widest uppercase rounded-xl transition-all active:scale-95 cursor-pointer shadow border border-[#F95C4B]/10 animate-fade-in"
                >
                  Reset Active Workspace
                </button>
              </div>

            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ==========================================
          MODAL: PROFILE MANAGEMENT & AVATAR UPLOADER
          ========================================== */}
      <AnimatePresence>
        {showProfileModal && (
          <>
            {/* Overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProfileModal(false)}
              className="fixed inset-0 bg-black z-50 pointer-events-auto"
            />

            {/* Centered Squircle Modal */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-[2.5rem] p-8 max-w-sm w-[90%] mx-auto z-50 shadow-2xl select-none pointer-events-auto flex flex-col items-center text-center text-[var(--color-text)]"
            >
              {/* Header */}
              <div className="flex items-center justify-between w-full border-b border-[var(--color-border)] pb-4 mb-6">
                <div className="flex items-center gap-2">
                  <User className="w-5 h-5 text-[#F95C4B]" />
                  <span className="font-sans font-black text-[var(--color-text)] text-[14px]">Profile Management</span>
                </div>
                <button 
                  onClick={() => setShowProfileModal(false)}
                  className="p-1 rounded text-[var(--color-subtext)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Large Profile Avatar Display */}
              <div className="relative group w-32 h-32 rounded-full bg-[var(--color-bg)] border-2 border-[#F95C4B]/40 p-1 mb-5 flex items-center justify-center font-mono overflow-hidden shadow-md">
                {currentUser?.photoURL ? (
                  <img src={currentUser.photoURL} alt="Large Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="text-4xl font-black text-[var(--color-text)]">
                    {(currentUser?.displayName || 'Manasseh')[0].toUpperCase()}
                  </span>
                )}
                
                {/* Micro spinner overlay when uploading */}
                {isUpdatingProfile && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5 text-white">
                    <Loader2 className="h-6 w-6 animate-spin text-[#F95C4B]" />
                    <span className="text-[9px] font-mono tracking-wider uppercase font-black">Uploading...</span>
                  </div>
                )}
              </div>

              {/* Upload Input & Trigger Button */}
              <div className="mb-6 w-full">
                <input 
                  type="file" 
                  id="avatar-upload-input" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleAvatarChange}
                  disabled={isUpdatingProfile}
                />
                
                <label 
                  htmlFor="avatar-upload-input"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#F95C4B] hover:bg-[#F95C4B]/90 text-white font-mono font-black text-xs tracking-wider uppercase rounded-2xl transition-all active:scale-95 cursor-pointer shadow-md disabled:opacity-50"
                  style={{ cursor: 'pointer' }}
                >
                  <Camera className="w-4 h-4" />
                  {isUpdatingProfile ? 'Uploading...' : 'Change Avatar'}
                </label>
                
                {profileError && (
                  <div className="mt-3 text-red-500 font-mono text-[10px] leading-snug px-4">
                    {profileError}
                  </div>
                )}
              </div>

              {/* User Identity Details */}
              <div className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[1.8rem] p-4 mb-6 text-left space-y-2">
                <div>
                  <span className="text-[8px] font-mono text-[var(--color-subtext)] uppercase tracking-widest block font-black">Full Name</span>
                  <span className="text-sm font-sans font-black text-[var(--color-text)] block">
                    {currentUser?.displayName || 'Manasseh'}
                  </span>
                </div>
                <div>
                  <span className="text-[8px] font-mono text-[var(--color-subtext)] uppercase tracking-widest block font-black">Email Address</span>
                  <span className="text-xs font-mono font-semibold text-[var(--color-text)] block truncate">
                    {currentUser?.email || 'kuskomanass@gmail.com'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <button 
                onClick={() => setShowProfileModal(false)}
                className="w-full py-3 bg-[var(--color-bubble)] hover:bg-[var(--color-border)] text-[var(--color-text)] font-mono font-black text-xs tracking-widest uppercase rounded-2xl transition-all active:scale-95 cursor-pointer border border-[var(--color-border)] shadow"
              >
                Close Profile
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
