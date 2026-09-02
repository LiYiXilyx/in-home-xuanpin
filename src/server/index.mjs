import http from 'node:http';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { loadConfig } from '../config/load.mjs';
import { migrateDatabase } from '../db/migrate.mjs';
import { openDatabase } from '../db/client.mjs';
import { createJobRepository } from '../db/repositories/job-repository.mjs';
import { createReviewRepository } from '../db/repositories/review-repository.mjs';
import { createReviewQueueRepository } from '../db/repositories/review-queue-repository.mjs';
import { createNavigationResolutionRepository } from '../db/repositories/navigation-resolution-repository.mjs';
import { createCatalogPoolReadRepository } from '../db/repositories/catalog-pool-read-repository.mjs';
import { createCatalogScopedExportRepository } from '../db/repositories/catalog-scoped-export-repository.mjs';
import { createCatalogCampaignService } from '../modules/catalog-scale/catalog-campaign-service.mjs';
import { createCategoryProfileRegistry } from '../modules/catalog-scale/category-profile-registry.mjs';
import { createOperatorCategoryProfileStore } from '../modules/catalog-scale/operator-category-profile-store.mjs';
import { normalizeOperatorCategoryProfile } from '../modules/catalog-scale/operator-category-profile.mjs';
import { createCatalogScopedExportService } from '../modules/catalog-scale/catalog-scoped-export-service.mjs';
import { createJobService } from '../jobs/job-service.mjs';
import { createReviewQueueService } from '../modules/reviews/review-queue-service.mjs';
import { createBrowserController } from './controllers/browser-controller.mjs';
import { createJobController } from './controllers/job-controller.mjs';
import { createReviewController } from './controllers/review-controller.mjs';
import { createReviewQueueController } from './controllers/review-queue-controller.mjs';
import { createCatalogController } from './controllers/catalog-controller.mjs';
import { createSourcingController } from './controllers/sourcing-controller.mjs';
import { createExportController } from './controllers/export-controller.mjs';
import { createTestController } from './controllers/test-controller.mjs';
import { createStatusService } from './status-service.mjs';
import { createStaticServer } from './static-server.mjs';
import { createRouter } from './router.mjs';
import { createSourcingSettings } from '../modules/sourcing/sourcing-settings.mjs';
import { chooseNativePath } from '../modules/sourcing/native-path-dialog.mjs';
import { migrateSourcingDatabase } from '../modules/sourcing/sourcing-db.mjs';
import { createSourcingRepository } from '../db/repositories/sourcing-repository.mjs';
import { createSourcingReviewRepository } from '../db/repositories/sourcing-review-repository.mjs';
import { createTemuSourcingContextRepository,openTemuContextDatabase } from '../db/repositories/temu-sourcing-context-repository.mjs';
import { createYingdaoImportService } from '../modules/sourcing/yingdao-import-service.mjs';
import { createSourcingReviewService } from '../modules/sourcing/sourcing-review-service.mjs';
import { createSourcingReviewImageResolver } from '../modules/sourcing/sourcing-review-images.mjs';
import { createSourcingReviewController } from './controllers/sourcing-review-controller.mjs';
import { loadRunOpportunityWorkbook } from '../modules/sourcing/review-opportunity-workbook.mjs';
import { resolveReviewFx } from '../modules/sourcing/review-opportunity-calculator.mjs';
import { loadSourcingConfig } from '../modules/sourcing/sourcing-1688.mjs';
import { loadVisualWorkbookUniverse } from '../modules/sourcing/visual-workbook-universe.mjs';
import { createLocalVisualEmbeddingBackend } from '../modules/sourcing/local-visual-embedding.mjs';
import { createVisualIndexStore } from '../modules/sourcing/visual-index-store.mjs';
import { createVisualReviewContext } from '../modules/sourcing/visual-review-context.mjs';
import { createVisualDisplayImageResolver } from '../modules/sourcing/visual-display-image.mjs';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

export async function createOperationsServer(options={}) {
  const config=options.config ?? await loadConfig(options.configPath ?? process.env.TEMU_CONFIG_PATH ?? path.join(projectDir,'config.json'));
  migrateDatabase({ databasePath:config.app.databasePath });
  const db=openDatabase(config.app.databasePath);
  const repository=createJobRepository(db);
  const reviewRepository=createReviewRepository(db);
  const reviewQueueRepository=createReviewQueueRepository(db);
  const navigationResolutionRepository=createNavigationResolutionRepository(db);
  const service=createJobService(repository);
  service.recoverInterrupted({ staleAfterMs:Number(config.browser.heartbeatTimeoutMs ?? 30_000) });
  const browserController=createBrowserController(config,options.browserDependencies);
  const exportController=createExportController({ config,repository,service,openTarget:options.openTarget,exportWorkbook:options.exportWorkbook });
  const testController=createTestController({ config,db,service,exportController });
  const jobController=createJobController({ config,repository,service,projectDir,runProcess:options.runProcess });
  const reviewController=createReviewController({ config,db,repository,reviewRepository,reviewQueueRepository,navigationResolutionRepository,service,projectDir,runProcess:options.runProcess });
  const reviewQueueService=createReviewQueueService({ db,jobRepository:repository,queueRepository:reviewQueueRepository,navigationRepository:navigationResolutionRepository,config });
  const reviewQueueController=createReviewQueueController({ queueService:reviewQueueService });
  const catalogService=createCatalogCampaignService(db);
  const catalogPoolReadRepository=createCatalogPoolReadRepository(db);
  const categoryProfileDirectory=path.resolve(options.categoryProfileDirectory ?? path.join(projectDir,'config/categories'));
  const configRoot=path.dirname(config.configPath??options.configPath??path.join(projectDir,'config.json'));
  const operatorProfileDirectory=path.resolve(options.operatorProfileDirectory??path.join(configRoot,'data/operator-category-profiles'));
  const categoryProfileRegistry=options.categoryProfileRegistry ?? createCategoryProfileRegistry({
    builtInDirectory:categoryProfileDirectory,operatorDirectory:operatorProfileDirectory
  });
  const builtInRegistry={async list(){const result=await categoryProfileRegistry.list();return{
    profiles:result.profiles.filter(profile=>profile.profile_origin==='BUILT_IN')
  };}};
  const operatorCategoryProfileStore=options.operatorCategoryProfileStore??createOperatorCategoryProfileStore({
    root:operatorProfileDirectory,builtInRegistry,validateInput:normalizeOperatorCategoryProfile
  });
  const catalogScopedExportService=options.catalogScopedExportService??createCatalogScopedExportService({
    repository:createCatalogScopedExportRepository(db),outputDir:path.join(config.export.outputDir,'catalog-scoped')
  });
  const catalogController=createCatalogController({ catalogService,categoryProfileRegistry,catalogPoolReadRepository,
    operatorCategoryProfileStore,catalogScopedExportService });
  const sourcingRoot=path.dirname(config.app.databasePath);
  const sourcingDatabasePath=options.sourcingDatabasePath??path.join(sourcingRoot,'1688_sourcing.db');
  migrateSourcingDatabase({databasePath:sourcingDatabasePath});
  const sourcingDb=openDatabase(sourcingDatabasePath,{allowRunnerWrite:true});
  const sourcingRepository=createSourcingRepository(sourcingDb);
  const sourcingService=options.sourcingService??createYingdaoImportService({repository:sourcingRepository});
  const sourcingSettings=options.sourcingSettings??createSourcingSettings({settingsPath:options.sourcingSettingsPath??path.join(sourcingRoot,'sourcing-console-settings.json')});
  const sourcingController=options.sourcingController??createSourcingController({
    service:sourcingService,repository:sourcingRepository,settingsStore:sourcingSettings,
    pathDialog:options.pathDialog??(input=>chooseNativePath({...input,runProcess:options.nativePathRunProcess})),
  });
  let temuContextDb=null;
  let sourcingReviewController=options.sourcingReviewController??null;
  if(!sourcingReviewController) {
    const reviewRunId=options.sourcingReviewRunId??process.env.SOURCING_REVIEW_RUN_ID??'yingdao_random5_v1_20260831_001';
    const reviewImport=sourcingRepository.getImport(reviewRunId);
    const opportunityContext=options.sourcingReviewOpportunityContext??(reviewImport?.selected_workbook_path?{
      ...await loadRunOpportunityWorkbook({
        workbookPath:reviewImport.selected_workbook_path,
        runGoodsIds:reviewImport.items.map(item=>String(item.temu_goods_id)),
      }),
      fx:resolveReviewFx(loadSourcingConfig(options.sourcingConfigPath??path.join(projectDir,'config/1688-sourcing-v1.json'))),
    }:null);
    const temuPathBase=config.configPath?path.dirname(config.configPath):projectDir;
    const temuImageRoot=config.export?.imageCacheDir??path.join(temuPathBase,'outputs/week1-mvp/image-cache');
    temuContextDb=openTemuContextDatabase(config.app.databasePath);
    const sourcingReviewRepository=createSourcingReviewRepository(sourcingDb);
    const temuContextRepository=createTemuSourcingContextRepository(temuContextDb,{projectRoot:temuPathBase,imageCacheRoot:temuImageRoot});
    const imageResolver=createSourcingReviewImageResolver({projectRoot:projectDir,temuPathBase,temuImageRoot});let visualContext=null;
    if(reviewImport?.selected_workbook_path){const universe=await loadVisualWorkbookUniverse({workbookPath:reviewImport.selected_workbook_path});const visualCacheRoot=options.sourcingVisualCacheRoot??path.join(path.dirname(reviewImport.selected_workbook_path),'visual-cache');const embeddingBackend=createLocalVisualEmbeddingBackend({cacheRoot:visualCacheRoot,sourcePath:path.join(projectDir,'tools/yingdao-vision-embed.swift')});const indexStore=createVisualIndexStore({cacheRoot:visualCacheRoot,embeddingBackend});const displayResolver=createVisualDisplayImageResolver({runId:reviewRunId,universe,indexStore,temuRepository:temuContextRepository,temuImageResolver:imageResolver});visualContext=createVisualReviewContext({universe,indexStore,currentRunId:reviewRunId,currentGoodsIds:[...new Set(reviewImport.items.map(item=>String(item.temu_goods_id)))],displayResolver});}
    const sourcingReviewService=createSourcingReviewService({
      sourcingRepository:sourcingReviewRepository,temuRepository:temuContextRepository,
      runId:reviewRunId,opportunityContext,visualContext,
    });
    sourcingReviewController=createSourcingReviewController({
      service:sourcingReviewService,imageResolver,
    });
  }
  const statusService=createStatusService({ db,jobRepository:repository,config,browserStatus:() => browserController.status(),
    latestExcel:exportController.latestExcel,currentExcel:exportController.currentExcel });
  const serveStatic=createStaticServer(path.join(projectDir,'ui'));
  const router=createRouter({ statusService,browserController,jobController,reviewController,reviewQueueController,catalogController,exportController,testController,sourcingController,sourcingReviewController,serveStatic,
    environment:{ name:config.app.environment,testMode:testController.isTestMode },logError:options.logError });
  const server=http.createServer(router);
  let closed=false;
  return {
    server,db,repository,service,catalogService,
    async listen({ host=options.host ?? '127.0.0.1',port=Number(options.port ?? process.env.TEMU_DASHBOARD_PORT ?? 37821) }={}) {
      if (host!=='127.0.0.1') throw new Error('运营台只允许绑定127.0.0.1。');
      await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,host,() => { server.off('error',reject); resolve(); }); });
      const address=server.address();
      const actualPort=typeof address === 'object' ? address.port : port;
      return { host,address:typeof address === 'object' ? address.address : host,port:actualPort,url:`http://${host}:${actualPort}` };
    },
    async close() {
      if (closed) return;
      closed=true;
      await browserController.closeConnection();
      if (server.listening) {
        await new Promise(resolve => {
          server.close(resolve);
          server.closeAllConnections?.();
        });
      }
      db.close();
      sourcingDb.close();
      temuContextDb?.close();
    }
  };
}

export async function startOperationsServer(options={}) {
  const app=await createOperationsServer(options);
  const address=await app.listen(options);
  console.log(`Temu 选品运营台：${address.url}`);
  const shutdown=async () => { await app.close(); process.exit(0); };
  process.once('SIGINT',shutdown);
  process.once('SIGTERM',shutdown);
  return { app,address };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  startOperationsServer().catch(error => { console.error(error?.stack ?? error); process.exitCode=1; });
}
