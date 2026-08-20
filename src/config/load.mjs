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
  coerceNumbers(structured);
  const baseDir = path.dirname(absolutePath);
  for (const [section, field] of PATH_FIELDS) structured[section][field] = path.resolve(baseDir, structured[section][field]);
  validateConfig(structured);
  return exposeLegacyRuntimeShape(structured, absolutePath);
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
    [config.reviews, 'negativeMaxRating'], [config.reviews, 'pilotBatchSize'],
    [config.reviews, 'minimumPilotSuccess'], [config.reviews, 'fastGrowthRatio']
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
