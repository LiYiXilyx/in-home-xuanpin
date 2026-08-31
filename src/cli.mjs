import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { captureCurrentCatalog, captureCurrentProductReviews, crawl, crawlReviews, refreshCatalog } from './crawler.mjs';
import { openDatabase } from './database.mjs';
import { seedDemo } from './demo.mjs';
import { runBrowserOpenCommand } from './app/commands/browser-open.mjs';
import { runCatalogCaptureCommand, runCatalogResumeCommand } from './app/commands/catalog-capture.mjs';
import { runImageRepairCommand } from './app/commands/image-repair.mjs';
import { runEvidenceRepairCommand } from './app/commands/evidence-repair.mjs';
import { runExportCommand,runExportQaCommand } from './app/commands/export.mjs';
import { runClassifyCommand } from './app/commands/classify.mjs';
import { runAnalyzeMarketCommand,runMarketQaCommand } from './app/commands/analyze-market.mjs';
import { runFineClassifyCommand } from './app/commands/fine-classify.mjs';
import { runDay9ReviewCaptureCommand,runDay9ReviewQaCommand } from './app/commands/review-capture.mjs';
import { runLifecycleCommand,runLifecycleQaCommand } from './app/commands/lifecycle.mjs';
import { runJobAction, runStatusCommand } from './app/commands/status.mjs';
import { MACHINE_ROLES,getMachineRole } from './modules/sourcing/machine-role.mjs';

const RUNNER_FORBIDDEN_COMMANDS=new Set(['init','browser-open','pause','resume','retry','cancel','capture','image-repair','classify','fine-classify','analyze-market','evidence-repair','lifecycle','review-capture','review-qa','current-review','refresh','crawl','reviews','demo']);

function parseArgs(argv) {
  const result = { command: argv[2] ?? 'help', config: 'config.json', rules: 'config/category-rules.example.json', profile:null,pool:null,category:null,batchSize: 10, retryFailed: false, includeReviewed: false, job: null, smoke: false, dryRun: false, target: null, limit: null, output: null, sort: 'asc', expectedActive: 1000, run: null, approve:false,apply:false,checked:[] };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === '--config') result.config = argv[++index];
    else if (argv[index] === '--rules') result.rules = argv[++index];
    else if (argv[index] === '--profile') result.profile = argv[++index];
    else if (argv[index] === '--pool') result.pool = argv[++index];
    else if (argv[index] === '--category') result.category = argv[++index];
    else if (argv[index] === '--batch-size') result.batchSize = Number(argv[++index]);
    else if (argv[index] === '--retry-failed') result.retryFailed = true;
    else if (argv[index] === '--include-reviewed') result.includeReviewed = true;
    else if (argv[index] === '--job') result.job = argv[++index];
    else if (argv[index] === '--smoke') result.smoke = true;
    else if (argv[index] === '--dry-run') result.dryRun = true;
    else if (argv[index] === '--target') result.target = Number(argv[++index]);
    else if (argv[index] === '--limit') result.limit = Number(argv[++index]);
    else if (argv[index] === '--output') result.output = argv[++index];
    else if (argv[index] === '--sort') result.sort = argv[++index];
    else if (argv[index] === '--expected-active') result.expectedActive = Number(argv[++index]);
    else if (argv[index] === '--run') result.run = argv[++index];
    else if (argv[index] === '--approve') result.approve = true;
    else if (argv[index] === '--apply') result.apply = true;
    else if (argv[index] === '--checked') result.checked = String(argv[++index] ?? '').split(',').map(item => item.trim()).filter(Boolean);
  }
  if (!Number.isInteger(result.batchSize) || result.batchSize < 1 || result.batchSize > 100) {
    throw new Error('--batch-size 必须是1到100之间的整数。');
  }
  if (result.target !== null && (!Number.isInteger(result.target) || result.target < 1)) throw new Error('--target 必须是正整数。');
  if (result.limit !== null && (!Number.isInteger(result.limit) || result.limit < 1)) throw new Error('--limit 必须是正整数。');
  if (!['asc','desc'].includes(String(result.sort).toLowerCase())) throw new Error('--sort 必须是 asc 或 desc。');
  if (!Number.isInteger(result.expectedActive) || result.expectedActive < 1) throw new Error('--expected-active 必须是正整数。');
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const machineRole=getMachineRole({required:false});
  if(machineRole===MACHINE_ROLES.RUNNER&&RUNNER_FORBIDDEN_COMMANDS.has(args.command))throw new Error(`1688_RUNNER 禁止执行 Temu 命令：${args.command}`);
  if (args.command === 'help') {
    console.log('用法：node src/cli.mjs <init|browser-open|status|pause|resume|retry|cancel|capture|classify|fine-classify|export|export-qa|analyze-market|market-qa|lifecycle|lifecycle-qa|review-capture|review-qa|current-review|refresh|crawl|reviews|demo> --config config.json');
    console.log('评论批次：node src/cli.mjs reviews --config config.json --batch-size 10 [--retry-failed] [--include-reviewed]');
    return;
  }
  if (args.command === 'init') {
    const target = path.resolve(args.config);
    try { await fs.access(target); throw new Error(`${target} 已存在，未覆盖。`); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.copyFile(new URL('../config.example.json', import.meta.url), target);
    console.log(`已创建 ${target}，请填写 jobs[].url 和子类目。`);
    return;
  }
  const config = await loadConfig(args.config);
  if (args.command === 'status') {
    runStatusCommand(config);
    return;
  }
  if (args.command === 'browser-open') {
    await runBrowserOpenCommand(config, { smoke: args.smoke });
    return;
  }
  if (args.command === 'capture') {
    await runCatalogCaptureCommand(config, { targetCount: args.target, dryRun: args.dryRun });
    return;
  }
  if (args.command === 'image-repair') {
    await runImageRepairCommand(config,{ limit: args.limit,dryRun: args.dryRun });
    return;
  }
  if (args.command === 'export') {
    await runExportCommand(config,{ jobId:args.job,output:args.output,sortDirection:args.sort,poolVersionId:args.pool,categoryKey:args.category });
    return;
  }
  if (args.command === 'export-qa') {
    await runExportQaCommand(config,{ jobId:args.job,output:args.output,poolVersionId:args.pool,categoryKey:args.category });
    return;
  }
  if (args.command === 'classify') {
    const result=await runClassifyCommand(config,{ jobId:args.job,rulesPath:args.rules,profilePath:args.profile,poolVersionId:args.pool });
    console.log(JSON.stringify(result,null,2));
    return;
  }
  if (args.command === 'fine-classify') {
    const result=await runFineClassifyCommand(config,{ jobId:args.job,rulesPath:args.rules === 'config/category-rules.example.json' ? undefined : args.rules,
      profilePath:args.profile,poolVersionId:args.pool });
    console.log(JSON.stringify(result,null,2));
    return;
  }
  if (args.command === 'analyze-market') {
    await runAnalyzeMarketCommand(config,{ jobId:args.job,output:args.output,expectedActiveCount:args.expectedActive });
    return;
  }
  if (args.command === 'market-qa') {
    await runMarketQaCommand(config,{ runId:args.run,expectedActiveCount:args.expectedActive });
    return;
  }
  if (args.command === 'evidence-repair') {
    await runEvidenceRepairCommand(config,{ apply:args.apply });
    return;
  }
  if (args.command === 'lifecycle') {
    await runLifecycleCommand(config,{ output:args.output,expectedActiveCount:args.expectedActive });return;
  }
  if (args.command === 'lifecycle-qa') {
    await runLifecycleQaCommand(config,{ runId:args.run,workbookPath:args.output,expectedActiveCount:args.expectedActive });return;
  }
  if (args.command === 'review-capture') {
    const result=await runDay9ReviewCaptureCommand(config,{ targetCount:args.target ?? 10,jobId:args.job });
    console.log(JSON.stringify(result,null,2));return;
  }
  if (args.command === 'review-qa') {
    runDay9ReviewQaCommand(config,{ jobId:args.job,approve:args.approve,manualCheckedGoodsIds:args.checked });return;
  }
  if (args.command === 'resume') {
    await runCatalogResumeCommand(config, args.job);
    return;
  }
  if (args.command === 'retry') {
    await runCatalogResumeCommand(config, args.job, { retry: true });
    return;
  }
  if (['pause', 'cancel'].includes(args.command)) {
    runJobAction(config, args.command, args.job);
    return;
  }
  const db = openDatabase(config.databasePath);
  try {
    if (args.command === 'current-review') {
      const result = await captureCurrentProductReviews(config, db);
      console.log(`当前商品评论完成：Top Sales #${result.listingRank ?? '-'}，结果=${result.resultCode}，库内评论=${result.reviewCount}，本次扫描=${result.newReviews}。`);
    } else if (args.command === 'refresh') {
      const result = await refreshCatalog(config, db);
      console.log(`商品池刷新完成：run=${result.runId}，当前商品=${result.active}，新增=${result.added}，继续在售=${result.retained}，退出当前池=${result.archived}。`);
    } else if (args.command === 'crawl') {
      const result = await crawl(config, db);
      console.log(`采集完成：run=${result.runId}，成功商品=${result.completed}。运行 npm run export 生成Excel。`);
    } else if (args.command === 'reviews') {
      const result = await crawlReviews(config, db, args);
      console.log(`评论批次完成：run=${result.runId}，成功商品=${result.completed}，跳过商品=${result.skipped}，失败商品=${result.failed}，本次扫描评论=${result.reviewsSeen}。`);
      if (result.pilotAcceptance) {
        console.log(`前10商品验收：${result.pilotAcceptance.successful}/${result.pilotAcceptance.attempted} 成功，要求至少 ${result.pilotAcceptance.requiredSuccess} 个，结果=${result.pilotAcceptance.passed ? '通过' : '未通过'}。`);
      }
      console.log(`进度：${JSON.stringify(result.summary)}`);
    } else if (args.command === 'demo') {
      const result = seedDemo(config, db);
      console.log(`示例数据已写入：run=${result.runId}，商品=${result.completed}。`);
    } else {
      throw new Error(`未知命令：${args.command}`);
    }
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
});
