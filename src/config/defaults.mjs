export const DEFAULT_CONFIG = Object.freeze({
  app: {
    environment: 'development',
    databasePath: './data/temu_research_v2.db',
    legacyDatabasePath: './data/temu_week1.db',
    backupDir: './backups',
    logDir: './logs'
  },
  browser: {
    mode: 'managed_profile',
    profileDir: './browser-profile',
    headless: false,
    executablePath: '',
    cdpEndpoint: '',
    launchViaCdp: true,
    debugPort: 9227,
    locale: 'en-DE',
    pauseBeforeStart: true,
    minimumDelayMs: 1500,
    maximumDelayMs: 3000,
    manualGateTimeoutMs: 1800000,
    manualGatePollMs: 500,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 30000,
    closeLaunchedBrowserOnExit: false,
    minimumCatalogCount: 50,
    manualRetryLimit: 8,
    maxStaleRounds: 6,
    maxReviewPages: 20,
    saveSnapshots: true
  },
  catalog: {
    siteCountry: '德国',
    language: 'en',
    currency: 'EUR',
    exchangeRateRmb: 8,
    targetCount: 100,
    capture: {
      minSafeCount: 100,
      maxStaleRounds: 6,
      maxExpansions: 4,
      minimumDelayMs: 1500,
      maximumDelayMs: 3000,
      imageMinimumBytes: 1024,
      imageTimeoutMs: 30000,
      imageConcurrency: 3
    },
    jobs: [],
    selectors: {},
    selectionRules: {
      minPriceEur: 5,
      minRating: 4.6,
      minRecentDailyReviews: 3,
      excludeElectronic: true,
      excludeUsb: true,
      electronicTerms: [],
      usbTerms: []
    }
  },
  export: {
    outputDir: './outputs/week1-mvp',
    imageCacheDir: './outputs/week1-mvp/image-cache'
  },
  fineClassification: {
    rulesPath: './config/fine-category-rules.v1.json',
    autoAcceptConfidence: 0.85,
    reviewAcceptConfidence: 0.65,
    ai: { enabled:false,provider:'openai-compatible',baseUrl:'',model:'',modelVersion:'',apiKeyEnv:'TEMU_FINE_CLASSIFIER_API_KEY',timeoutMs:30000 }
  },
  reviews: {
    enabled: false,
    maxPagesPerProduct: 200,
    negativeMaxRating: 3,
    pilotBatchSize: 10,
    minimumPilotSuccess: 8,
    pilotFullHistory: true,
    fastGrowthRatio: 1.5
  }
});

export function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return structuredClone(override ?? base);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] = isObject(value) && isObject(result[key]) ? deepMerge(result[key], value) : structuredClone(value);
  }
  return result;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
