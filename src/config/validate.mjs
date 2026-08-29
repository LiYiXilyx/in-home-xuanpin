import { ConfigError } from '../shared/errors.mjs';

const REQUIRED_JOB_FIELDS = ['url', 'primaryCategory', 'subcategory', 'sortOrder'];

export function validateConfig(config) {
  requireObject(config.app, 'app');
  requireString(config.app.databasePath, 'app.databasePath');
  requireString(config.app.legacyDatabasePath, 'app.legacyDatabasePath');
  requireString(config.app.backupDir, 'app.backupDir');
  requireString(config.app.logDir, 'app.logDir');
  requireObject(config.browser, 'browser');
  if (!['managed_profile','external_cdp'].includes(config.browser.mode)) fail('browser.mode','必须是 managed_profile 或 external_cdp');
  if (config.browser.mode === 'managed_profile') requireString(config.browser.profileDir, 'browser.profileDir');
  if (config.browser.mode === 'external_cdp') requireString(config.browser.cdpEndpoint, 'browser.cdpEndpoint');
  if (config.browser.fixedProfile?.enabled) {
    for (const field of ['sessionFile','executablePath','userDataDir','profileDirectory']) {
      requireString(config.browser.fixedProfile[field],`browser.fixedProfile.${field}`);
    }
    if (config.browser.fixedProfile.captureMode!==undefined) requireString(config.browser.fixedProfile.captureMode,'browser.fixedProfile.captureMode');
    if (config.browser.fixedProfile.localServerEndpoint!==undefined) requireString(config.browser.fixedProfile.localServerEndpoint,'browser.fixedProfile.localServerEndpoint');
    for (const field of ['cdpRequired','extensionPassiveRequired']) if (config.browser.fixedProfile[field]!==undefined && typeof config.browser.fixedProfile[field]!=='boolean') fail(`browser.fixedProfile.${field}`,'必须是布尔值');
  }
  requireObject(config.catalog, 'catalog');
  if (config.catalog.manualPassiveCapture?.enabled) {
    if (config.catalog.manualPassiveCapture.cdpRequired!==false) fail('catalog.manualPassiveCapture.cdpRequired','正式被动采集必须为 false');
    if (config.catalog.manualPassiveCapture.extensionPassiveRequired!==true) fail('catalog.manualPassiveCapture.extensionPassiveRequired','正式被动采集必须为 true');
    requireString(config.catalog.manualPassiveCapture.localServerEndpoint,'catalog.manualPassiveCapture.localServerEndpoint');
    if (config.catalog.manualPassiveCapture.localServerEndpoint!=='http://127.0.0.1:37821') fail('catalog.manualPassiveCapture.localServerEndpoint','必须固定为 http://127.0.0.1:37821');
    if (!Array.isArray(config.catalog.manualPassiveCapture.stageTargets) || config.catalog.manualPassiveCapture.stageTargets.map(Number).join(',')!=='50,300,3000') fail('catalog.manualPassiveCapture.stageTargets','必须严格为 50,300,3000');
  }
  requireObject(config.export, 'export');
  requireObject(config.reviews, 'reviews');
  requireObject(config.fineClassification, 'fineClassification');
  requireString(config.fineClassification.rulesPath,'fineClassification.rulesPath');
  finiteNumber(config.fineClassification.autoAcceptConfidence,'fineClassification.autoAcceptConfidence');
  finiteNumber(config.fineClassification.reviewAcceptConfidence,'fineClassification.reviewAcceptConfidence');
  if (!(config.fineClassification.reviewAcceptConfidence >= 0 && config.fineClassification.reviewAcceptConfidence < config.fineClassification.autoAcceptConfidence && config.fineClassification.autoAcceptConfidence <= 1)) fail('fineClassification','置信度阈值必须满足0 <= reviewAccept < autoAccept <= 1');
  requireObject(config.fineClassification.ai,'fineClassification.ai');
  if (typeof config.fineClassification.ai.enabled !== 'boolean') fail('fineClassification.ai.enabled','必须是布尔值');
  for (const field of ['provider','baseUrl','model','modelVersion','apiKeyEnv']) {
    if (typeof config.fineClassification.ai[field] !== 'string') fail(`fineClassification.ai.${field}`,'必须是字符串');
  }
  positiveInteger(config.fineClassification.ai.timeoutMs,'fineClassification.ai.timeoutMs');

  if (!Array.isArray(config.catalog.jobs) || config.catalog.jobs.length === 0) {
    fail('catalog.jobs', '至少需要一个采集任务');
  }
  for (const [index, job] of config.catalog.jobs.entries()) {
    requireObject(job, `catalog.jobs[${index}]`);
    for (const field of REQUIRED_JOB_FIELDS) requireString(job[field], `catalog.jobs[${index}].${field}`);
    if (job.targetCount != null) positiveInteger(job.targetCount, `catalog.jobs[${index}].targetCount`);
  }

  positiveInteger(config.catalog.targetCount, 'catalog.targetCount');
  requireObject(config.catalog.capture, 'catalog.capture');
  for (const field of ['minSafeCount', 'maxStaleRounds', 'maxExpansions', 'imageMinimumBytes', 'imageTimeoutMs', 'imageConcurrency']) {
    positiveInteger(config.catalog.capture[field], `catalog.capture.${field}`);
  }
  finiteNumber(config.catalog.capture.minimumDelayMs, 'catalog.capture.minimumDelayMs');
  finiteNumber(config.catalog.capture.maximumDelayMs, 'catalog.capture.maximumDelayMs');
  if (config.catalog.capture.minimumDelayMs < 0 || config.catalog.capture.maximumDelayMs < config.catalog.capture.minimumDelayMs) {
    fail('catalog.capture.maximumDelayMs', '必须不小于非负的 minimumDelayMs');
  }
  positiveNumber(config.catalog.exchangeRateRmb, 'catalog.exchangeRateRmb');
  for (const field of ['minPriceEur', 'minRating', 'minRecentDailyReviews']) {
    finiteNumber(config.catalog.selectionRules?.[field], `catalog.selectionRules.${field}`);
  }
  positiveInteger(config.browser.minimumCatalogCount, 'browser.minimumCatalogCount');
  finiteNumber(config.browser.minimumDelayMs, 'browser.minimumDelayMs');
  finiteNumber(config.browser.maximumDelayMs, 'browser.maximumDelayMs');
  positiveInteger(config.browser.manualGateTimeoutMs, 'browser.manualGateTimeoutMs');
  positiveInteger(config.browser.manualGatePollMs, 'browser.manualGatePollMs');
  positiveInteger(config.browser.heartbeatIntervalMs, 'browser.heartbeatIntervalMs');
  positiveInteger(config.browser.heartbeatTimeoutMs, 'browser.heartbeatTimeoutMs');
  if (config.browser.maximumDelayMs < config.browser.minimumDelayMs) {
    fail('browser.maximumDelayMs', '不能小于 browser.minimumDelayMs');
  }
  finiteNumber(config.reviews.negativeMaxRating, 'reviews.negativeMaxRating');
  positiveInteger(config.reviews.maxPagesPerProduct,'reviews.maxPagesPerProduct');
  requireObject(config.reviews.navigationSafety,'reviews.navigationSafety');
  if (typeof config.reviews.navigationSafety.enabled !== 'boolean') fail('reviews.navigationSafety.enabled','必须是布尔值');
  for (const field of ['cooldownMs','minimumNavigationIntervalMs']) {
    finiteNumber(config.reviews.navigationSafety[field],`reviews.navigationSafety.${field}`);
    if (config.reviews.navigationSafety[field] < 0) fail(`reviews.navigationSafety.${field}`,'不能小于 0');
  }
  positiveInteger(config.reviews.navigationSafety.maxNavigationAttemptsPerSession,'reviews.navigationSafety.maxNavigationAttemptsPerSession');
  positiveInteger(config.reviews.navigationSafety.maxProductsPerSession,'reviews.navigationSafety.maxProductsPerSession');
  if (config.reviews.negativeMaxRating < 1 || config.reviews.negativeMaxRating > 5) {
    fail('reviews.negativeMaxRating', '必须在 1 到 5 之间');
  }
  requireString(config.export.outputDir, 'export.outputDir');
  requireString(config.export.imageCacheDir, 'export.imageCacheDir');
  return config;
}

function requireObject(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(fieldPath, '必须是对象');
}
function requireString(value, fieldPath) {
  if (typeof value !== 'string' || value.trim() === '') fail(fieldPath, '不能为空');
}
function finiteNumber(value, fieldPath) {
  if (!Number.isFinite(Number(value))) fail(fieldPath, '必须是数字');
}
function positiveNumber(value, fieldPath) {
  finiteNumber(value, fieldPath);
  if (Number(value) <= 0) fail(fieldPath, '必须大于 0');
}
function positiveInteger(value, fieldPath) {
  if (!Number.isInteger(Number(value)) || Number(value) < 1) fail(fieldPath, '必须是正整数');
}
function fail(fieldPath, message) {
  throw new ConfigError(`${fieldPath} ${message}。`, { fieldPath });
}
