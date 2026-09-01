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
import { createCatalogCampaignService } from '../modules/catalog-scale/catalog-campaign-service.mjs';
import { createCategoryProfileRegistry } from '../modules/catalog-scale/category-profile-registry.mjs';
import { createJobService } from '../jobs/job-service.mjs';
import { createReviewQueueService } from '../modules/reviews/review-queue-service.mjs';
import { createBrowserController } from './controllers/browser-controller.mjs';
import { createJobController } from './controllers/job-controller.mjs';
import { createReviewController } from './controllers/review-controller.mjs';
import { createReviewQueueController } from './controllers/review-queue-controller.mjs';
import { createCatalogController } from './controllers/catalog-controller.mjs';
import { createExportController } from './controllers/export-controller.mjs';
import { createTestController } from './controllers/test-controller.mjs';
import { createStatusService } from './status-service.mjs';
import { createStaticServer } from './static-server.mjs';
import { createRouter } from './router.mjs';

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
  const categoryProfileRegistry=options.categoryProfileRegistry ?? createCategoryProfileRegistry({ directory:categoryProfileDirectory });
  const catalogController=createCatalogController({ catalogService,categoryProfileRegistry,catalogPoolReadRepository });
  const statusService=createStatusService({ db,jobRepository:repository,config,browserStatus:() => browserController.status(),
    latestExcel:exportController.latestExcel,currentExcel:exportController.currentExcel });
  const serveStatic=createStaticServer(path.join(projectDir,'ui'));
  const router=createRouter({ statusService,browserController,jobController,reviewController,reviewQueueController,catalogController,exportController,testController,serveStatic,
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
