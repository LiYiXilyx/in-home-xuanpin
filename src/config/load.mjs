import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG, deepMerge } from './defaults.mjs';
import { validateConfig } from './validate.mjs';
import { ConfigError } from '../shared/errors.mjs';

const PATH_FIELDS = [
  ['app', 'databasePath'], ['app', 'legacyDatabasePath'], ['app', 'backupDir'], ['app', 'logDir'],
  ['browser', 'profileDir'], ['export', 'outputDir'], ['export', 'imageCacheDir']
];

export async function loadConfig(configPath = 'config.json') {
  const absolutePath = path.resolve(configPath);
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ConfigError(`${absolutePath} 不是有效 JSON。`, { fieldPath: '$', cause: error });
    throw error;
  }
  const structured = deepMerge(DEFAULT_CONFIG, normalizeInput(raw));
  applyFineClassifierEnvironment(structured);
  coerceNumbers(structured);
  const baseDir = path.dirname(absolutePath);
  for (const [section, field] of PATH_FIELDS) structured[section][field] = path.resolve(baseDir, structured[section][field]);
  await applyBrowserRuntime(structured,baseDir);
  validateConfig(structured);
  return exposeLegacyRuntimeShape(structured, absolutePath);
}

function applyFineClassifierEnvironment(config) {
  const ai=config.fineClassification.ai;
  if (process.env.TEMU_FINE_CLASSIFIER_ENABLED !== undefined) ai.enabled=parseBoolean(process.env.TEMU_FINE_CLASSIFIER_ENABLED);
  if (process.env.TEMU_FINE_CLASSIFIER_PROVIDER) ai.provider=process.env.TEMU_FINE_CLASSIFIER_PROVIDER;
  if (process.env.TEMU_FINE_CLASSIFIER_MODEL) ai.model=process.env.TEMU_FINE_CLASSIFIER_MODEL;
  if (process.env.TEMU_FINE_CLASSIFIER_BASE_URL) ai.baseUrl=process.env.TEMU_FINE_CLASSIFIER_BASE_URL;
  // The secret is deliberately read only by the provider at call time.
  ai.apiKeyEnv='TEMU_FINE_CLASSIFIER_API_KEY';
}

function parseBoolean(value) {
  return ['1','true','yes','on'].includes(String(value).trim().toLowerCase());
}

async function applyBrowserRuntime(config,baseDir) {
  if (process.env.TEMU_BROWSER_MODE) config.browser.mode=process.env.TEMU_BROWSER_MODE;
  if (process.env.TEMU_BROWSER_CDP_ENDPOINT) config.browser.cdpEndpoint=process.env.TEMU_BROWSER_CDP_ENDPOINT;
  if (config.browser.mode === 'external_cdp') return;
  const statePath=path.join(path.dirname(config.app.databasePath),'browser-runtime.json');
  const state=await fs.readFile(statePath,'utf8').then(JSON.parse).catch(() => null);
  const stateProfile=String(state?.profileDir ?? '');
  if (stateProfile && path.dirname(path.resolve(stateProfile)) === baseDir && /^browser-profile(?:-|$)/i.test(path.basename(stateProfile))) {
    config.browser.profileDir=path.resolve(stateProfile);
  }
  if (Number.isInteger(Number(state?.debugPort)) && Number(state.debugPort)>=1024 && Number(state.debugPort)<=65535) {
    config.browser.debugPort=Number(state.debugPort);
  }
  if (process.env.TEMU_BROWSER_PROFILE_DIR) config.browser.profileDir=path.resolve(process.env.TEMU_BROWSER_PROFILE_DIR);
  if (process.env.TEMU_BROWSER_DEBUG_PORT) config.browser.debugPort=Number(process.env.TEMU_BROWSER_DEBUG_PORT);
}

function normalizeInput(raw) {
  if (raw.app || raw.catalog || raw.export || raw.reviews) return raw;
  return {
    app: {
      databasePath: raw.v2DatabasePath,
      legacyDatabasePath: raw.legacyDatabasePath ?? raw.databasePath,
      backupDir: raw.backupDir,
      logDir: raw.logDir
    },
    browser: { ...raw.browser, profileDir: raw.profileDir },
    catalog: {
      siteCountry: raw.siteCountry,
      language: raw.language,
      currency: raw.currency,
      exchangeRateRmb: raw.exchangeRateRmb,
      targetCount: raw.targetCount,
      jobs: raw.jobs,
      selectors: raw.selectors,
      selectionRules: raw.selectionRules
    },
    export: { outputDir: raw.outputDir, imageCacheDir: raw.imageCacheDir },
    reviews: raw.reviewAnalysis
  };
}

function coerceNumbers(config) {
  const fields = [
    [config.catalog, 'exchangeRateRmb'], [config.catalog, 'targetCount'],
    [config.catalog.capture, 'minSafeCount'], [config.catalog.capture, 'maxStaleRounds'],
    [config.catalog.capture, 'maxExpansions'], [config.catalog.capture, 'minimumDelayMs'],
    [config.catalog.capture, 'maximumDelayMs'], [config.catalog.capture, 'imageMinimumBytes'],
    [config.catalog.capture, 'imageTimeoutMs'], [config.catalog.capture, 'imageConcurrency'],
    [config.browser, 'minimumDelayMs'], [config.browser, 'maximumDelayMs'],
    [config.browser, 'minimumCatalogCount'], [config.browser, 'manualRetryLimit'],
    [config.browser, 'manualGateTimeoutMs'], [config.browser, 'manualGatePollMs'],
    [config.browser, 'heartbeatIntervalMs'], [config.browser, 'heartbeatTimeoutMs'],
    [config.browser, 'maxStaleRounds'], [config.browser, 'maxReviewPages'],
    [config.reviews, 'negativeMaxRating'], [config.reviews, 'maxPagesPerProduct'], [config.reviews, 'pilotBatchSize'],
    [config.reviews, 'minimumPilotSuccess'], [config.reviews, 'fastGrowthRatio'], [config.reviews, 'sessionRecoveryMinimumAvailable'],
    [config.reviews.navigationSafety, 'cooldownMs'], [config.reviews.navigationSafety, 'minimumNavigationIntervalMs'],
    [config.reviews.navigationSafety, 'maxNavigationAttemptsPerSession'], [config.reviews.navigationSafety, 'maxProductsPerSession'],
    [config.fineClassification.ai, 'timeoutMs']
  ];
  for (const [owner, field] of fields) owner[field] = Number(owner[field]);
}

function exposeLegacyRuntimeShape(config, configPath) {
  return {
    ...config,
    configPath,
    // Day 1 keeps the legacy collector isolated from the v2 migration-owned database.
    databasePath: config.app.legacyDatabasePath,
    outputDir: config.export.outputDir,
    profileDir: config.browser.profileDir,
    siteCountry: config.catalog.siteCountry,
    language: config.catalog.language,
    currency: config.catalog.currency,
    exchangeRateRmb: config.catalog.exchangeRateRmb,
    targetCount: config.catalog.targetCount,
    jobs: config.catalog.jobs,
    selectors: config.catalog.selectors,
    selectionRules: config.catalog.selectionRules,
    reviewAnalysis: config.reviews
  };
}
