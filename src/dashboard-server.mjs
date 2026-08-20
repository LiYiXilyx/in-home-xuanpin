import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config/load.mjs';
import { openDatabase as openV2Database } from './db/client.mjs';
import { migrateDatabase } from './db/migrate.mjs';
import { createJobRepository } from './db/repositories/job-repository.mjs';
import { createJobService } from './jobs/job-service.mjs';
import { readLatestDashboardTask, toDashboardTask } from './jobs/job-view.mjs';
import { configuredCdpEndpoint, isCdpReady, openBrowserSession, closeBrowserSession } from './browser/cdp-session.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(projectDir, 'ui');
const databasePath = path.join(projectDir, 'data', 'temu_week1.db');
const outputDir = path.join(projectDir, 'outputs', 'week1-mvp');
const primaryExcelPath = path.join(outputDir, 'Temu第一周选品结果.xlsx');
const configPath = path.resolve(process.env.TEMU_CONFIG_PATH || path.join(projectDir, 'config.json'));
const host = '127.0.0.1';
const port = Number(process.env.TEMU_DASHBOARD_PORT || 37821);
const runtimeConfig = await loadConfig(configPath);
migrateDatabase({ databasePath: runtimeConfig.app.databasePath });
const jobDatabase = openV2Database(runtimeConfig.app.databasePath);
const jobRepository = createJobRepository(jobDatabase);
const jobService = createJobService(jobRepository);
jobService.recoverInterrupted({ staleAfterMs: runtimeConfig.browser.heartbeatTimeoutMs });

const taskDefinitions = {
  capture: {
    label: '采集当前 Top Sales 页面',
    steps: [
      { label: '采集 Chrome 当前商品页', args: ['src/cli.mjs', 'capture', '--config', 'config.json'] },
      { label: '更新运营 Excel', args: ['tools/build-report.mjs', '--config', 'config.json'] }
    ]
  },
  'current-review': {
    label: '采集运营当前商品评论',
    steps: [
      { label: '读取当前商品页并抓取评论', args: ['src/cli.mjs', 'current-review', '--config', 'config.json'] },
      { label: '更新运营 Excel', args: ['tools/build-report.mjs', '--config', 'config.json'] }
    ]
  },
  reviews: {
    label: '验收 Top Sales 前10商品评论',
    steps: [
      { label: '抓取 Top Sales 前10商品评论', args: ['src/cli.mjs', 'reviews', '--config', 'config.json', '--batch-size', '10'] },
      { label: '更新运营 Excel', args: ['tools/build-report.mjs', '--config', 'config.json'] }
    ]
  },
  retry: {
    label: '重试失败评论',
    steps: [
      { label: '重试失败商品评论', args: ['src/cli.mjs', 'reviews', '--config', 'config.json', '--batch-size', '10', '--retry-failed'] },
      { label: '更新运营 Excel', args: ['tools/build-report.mjs', '--config', 'config.json'] }
    ]
  },
  export: {
    label: '重新导出运营 Excel',
    steps: [
      { label: '生成并检查运营 Excel', args: ['tools/build-report.mjs', '--config', 'config.json'] }
    ]
  },
  clear: {
    label: '清除运营 Excel 内容',
    steps: [
      { label: '保留表头并清除 Excel 数据', args: ['tools/build-report.mjs', '--config', 'config.json', '--empty'] }
    ]
  }
};

let currentChild = null;
let operatorSession = null;
let task = readLatestDashboardTask(jobService);

function browserSettings() {
  const debugPort = Number(runtimeConfig.browser.debugPort ?? 9227);
  return {
    endpoint: configuredCdpEndpoint(runtimeConfig),
    debugPort,
    executablePath: runtimeConfig.browser.executablePath,
    profileDir: runtimeConfig.browser.profileDir
  };
}

async function operatorBrowserReady() {
  return isCdpReady(browserSettings().endpoint, { timeoutMs: 900 });
}

async function openOperatorBrowser() {
  if (await operatorBrowserReady()) return { alreadyOpen: true };
  operatorSession = await openBrowserSession(runtimeConfig);
  return { alreadyOpen: false };
}

function persistentTask(job) {
  return toDashboardTask(jobService, job);
}

function refreshPersistentTask() {
  if (!task.id) return task;
  const job = jobService.get(task.id);
  if (job) task = persistentTask(job);
  return task;
}


function cleanOutput(value) {
  return String(value)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/\r(?!\n)/g, '\n');
}

function appendLog(value, source = 'info') {
  const cleaned = cleanOutput(value);
  for (const line of cleaned.split(/\r?\n/)) {
    const text = line.trimEnd();
    if (!text) continue;
    task.logs.push({ at: new Date().toISOString(), source, text });
    if (task.id && jobService.get(task.id)) {
      const level = source === 'stderr' || source === 'error' ? 'error' : source === 'success' ? 'success' : 'info';
      jobRepository.appendEvent(task.id, 'process_log', level, text, { source });
    }
  }
  if (task.logs.length > 400) task.logs.splice(0, task.logs.length - 400);
  if (/按\s*Enter|按回车|Press\s+Enter|点击运营台.*继续执行/i.test(cleaned)) task.waitingForInput = true;
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    task.step = step.label;
    task.waitingForInput = false;
    appendLog(`开始：${step.label}`, 'system');
    const child = spawn(process.execPath, step.args, {
      cwd: projectDir,
      env: { ...process.env, FORCE_COLOR: '0', TEMU_JOB_ID: task.id, TEMU_CONFIG_PATH: configPath },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    currentChild = child;
    child.stdout.on('data', chunk => appendLog(chunk.toString('utf8'), 'stdout'));
    child.stderr.on('data', chunk => appendLog(chunk.toString('utf8'), 'stderr'));
    child.on('error', error => reject(error));
    child.on('exit', code => {
      currentChild = null;
      task.waitingForInput = false;
      if (code === 0) {
        appendLog(`完成：${step.label}`, 'system');
        resolve();
      } else {
        reject(new Error(`${step.label}执行失败，退出码 ${code ?? '未知'}`));
      }
    });
  });
}

async function runPipeline(kind) {
  const definition = taskDefinitions[kind];
  const heartbeat = setInterval(() => {
    try {
      if (jobService.get(task.id)?.status === 'running') jobService.heartbeat(task.id, { step: task.step });
    } catch {}
  }, runtimeConfig.browser.heartbeatIntervalMs);
  heartbeat.unref();
  try {
    for (const step of definition.steps) await runStep(step);
    if (jobService.get(task.id)?.status === 'running') jobService.complete(task.id);
    task.status = jobService.get(task.id)?.status ?? 'completed';
    task.exitCode = 0;
    task.step = '全部完成';
    appendLog(`${definition.label}已完成。`, 'success');
  } catch (error) {
    const current = jobService.get(task.id);
    if (current?.status === 'running') jobService.fail(task.id, error);
    task.status = jobService.get(task.id)?.status ?? 'failed';
    task.exitCode = 1;
    task.step = '执行失败';
    appendLog(error.message, 'error');
  } finally {
    clearInterval(heartbeat);
    task.waitingForInput = false;
    task.finishedAt = new Date().toISOString();
  }
}

function startTask(kind) {
  const definition = taskDefinitions[kind];
  if (!definition) throw new Error('未知任务。');
  refreshPersistentTask();
  if (['current-review', 'reviews', 'retry'].includes(kind) && !databaseSummary().catalogReady) {
    throw new Error('当前商品池尚未完成一次有效采集。请先准备摩托配件 Top Sales 页面并运行“采集当前页面”。');
  }
  const job = jobService.create({
    jobType: jobTypeForTask(kind),
    mode: 'operator_current_page',
    siteCountry: runtimeConfig.catalog.siteCountry,
    language: runtimeConfig.catalog.language,
    currency: runtimeConfig.catalog.currency,
    primaryCategory: runtimeConfig.catalog.jobs[0]?.primaryCategory,
    subcategory: runtimeConfig.catalog.jobs[0]?.subcategory,
    sourceUrl: runtimeConfig.catalog.jobs[0]?.url,
    sortOrder: runtimeConfig.catalog.jobs[0]?.sortOrder,
    targetCount: runtimeConfig.catalog.targetCount,
    config: { label: definition.label, dashboardTaskKind: kind }
  });
  jobService.start(job.id);
  task = {
    id: job.id,
    kind,
    label: definition.label,
    status: 'running',
    step: '准备开始',
    waitingForInput: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: []
  };
  appendLog(`${definition.label}开始运行。`, 'system');
  void runPipeline(kind);
  return task;
}

function continueTask() {
  refreshPersistentTask();
  jobService.resolveManualGate(task.id);
  task = persistentTask(jobService.get(task.id));
}

function jobTypeForTask(kind) {
  if (kind === 'capture') return 'catalog';
  if (kind === 'current-review') return 'product_detail';
  if (kind === 'reviews' || kind === 'retry') return 'reviews';
  return 'export';
}

function databaseSummary() {
  if (!fs.existsSync(databasePath)) {
    return { activeProducts: 0, reviews: 0, pending: 0, inProgress: 0, completed: 0, failed: 0, catalogReady: false, lastCatalogRefresh: null };
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const productRow = db.prepare(`SELECT COUNT(*) AS count FROM products
      WHERE catalog_active=1 AND product_url NOT LIKE '%goods_id=demo%' AND subcategory<>'Demo'`).get();
    const reviewRow = db.prepare(`SELECT COUNT(*) AS count FROM reviews r JOIN products p ON p.id=r.product_id
      WHERE p.catalog_active=1 AND p.product_url NOT LIKE '%goods_id=demo%' AND p.subcategory<>'Demo'`).get();
    const progress = { pending: 0, inProgress: 0, completed: 0, failed: 0 };
    for (const row of db.prepare(`SELECT COALESCE(s.status,'untracked') AS status,COUNT(*) AS count FROM products p
      LEFT JOIN review_crawl_state s ON s.product_id=p.id
      WHERE p.catalog_active=1 AND p.product_url NOT LIKE '%goods_id=demo%' AND p.subcategory<>'Demo'
      GROUP BY COALESCE(s.status,'untracked')`).all()) {
      if (row.status === 'pending' || row.status === 'untracked') progress.pending += Number(row.count);
      if (row.status === 'in_progress') progress.inProgress = Number(row.count);
      if (row.status === 'completed') progress.completed = Number(row.count);
      if (row.status === 'failed') progress.failed = Number(row.count);
    }
    const catalogRun = db.prepare(`SELECT finished_at AS finishedAt FROM crawl_runs
      WHERE status='completed' AND json_extract(config_json,'$.mode') IN ('catalog-refresh','catalog-capture')
      ORDER BY id DESC LIMIT 1`).get();
    const activeProducts = Number(productRow.count);
    return {
      activeProducts,
      reviews: Number(reviewRow.count),
      ...progress,
      catalogReady: Boolean(catalogRun?.finishedAt),
      lastCatalogRefresh: catalogRun?.finishedAt ?? null
    };
  } finally {
    db.close();
  }
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error('请求内容过大。');
  }
  return body ? JSON.parse(body) : {};
}

function openWithDefaultApp(target) {
  if (!fs.existsSync(target)) throw new Error('文件尚未生成。');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command', 'Start-Process -FilePath $env:TEMU_OPERATOR_OPEN_TARGET'
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, TEMU_OPERATOR_OPEN_TARGET: target }
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}

function latestExcelPath() {
  if (!fs.existsSync(outputDir)) return null;
  const candidates = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.startsWith('Temu第一周选品结果') && entry.name.toLowerCase().endsWith('.xlsx'))
    .map(entry => {
      const target = path.join(outputDir, entry.name);
      return { target, modified: fs.statSync(target).mtimeMs };
    })
    .sort((left, right) => right.modified - left.modified);
  return candidates[0]?.target ?? (fs.existsSync(primaryExcelPath) ? primaryExcelPath : null);
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png'
};

async function serveStatic(requestPath, response) {
  const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const target = path.resolve(uiDir, relative);
  if (!target.startsWith(`${uiDir}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await fsp.readFile(target);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(data);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      json(response, 200, {
        task: refreshPersistentTask(),
        data: databaseSummary(),
        excelExists: Boolean(latestExcelPath()),
        browserReady: await operatorBrowserReady()
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/browser/open') {
      const result = await openOperatorBrowser();
      json(response, 200, { ok: true, browserReady: true, ...result });
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/tasks/')) {
      const body = await readJsonBody(request);
      const action = url.pathname.split('/').pop();
      if (action === 'continue') {
        continueTask();
        json(response, 200, { ok: true });
      } else {
        if (action === 'clear' && body.confirmed !== true) throw new Error('清除 Excel 前必须进行确认。');
        json(response, 202, { ok: true, task: startTask(action) });
      }
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/jobs/')) {
      const [, , , jobId, action] = url.pathname.split('/');
      if (!jobId || !action) throw new Error('任务控制路径无效。');
      let result;
      if (action === 'pause') result = jobService.pause(jobId);
      else if (action === 'cancel') result = jobService.cancel(jobId);
      else if (action === 'resume') {
        const job = jobService.get(jobId);
        result = job?.checkpoint?.manualGate ? jobService.resolveManualGate(jobId) : jobService.resume(jobId);
      } else if (action === 'retry') result = jobService.retry(jobId);
      else throw new Error(`未知任务操作：${action}`);
      task = persistentTask(result);
      json(response, 200, { ok: true, task });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/open/excel') {
      const target = latestExcelPath();
      if (!target) throw new Error('运营 Excel 尚未生成。');
      await openWithDefaultApp(target);
      json(response, 200, { ok: true, message: '已发送打开运营 Excel 请求。' });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/open/folder') {
      await openWithDefaultApp(outputDir);
      json(response, 200, { ok: true, message: '已发送打开结果文件夹请求。' });
      return;
    }
    if (request.method === 'GET') {
      await serveStatic(url.pathname, response);
      return;
    }
    json(response, 405, { error: '不支持的请求。' });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`运营台已经在 http://${host}:${port} 运行。`);
    process.exitCode = 2;
    return;
  }
  throw error;
});

server.listen(port, host, () => {
  console.log(`Temu选品运营台：http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try {
      if (task.id && jobService.get(task.id)?.status === 'running') jobService.interrupt(task.id, { step: task.step });
    } catch {}
    currentChild?.kill();
    void closeBrowserSession(operatorSession, runtimeConfig);
    jobDatabase.close();
    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 800).unref();
  });
}
