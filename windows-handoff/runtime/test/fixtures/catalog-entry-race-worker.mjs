import {parentPort,workerData} from 'node:worker_threads';
import {openDatabase} from '../../src/db/client.mjs';
import {createCatalogCampaignService} from '../../src/modules/catalog-scale/catalog-campaign-service.mjs';
if(workerData){const db=openDatabase(workerData.databasePath),state=new Int32Array(workerData.barrier);
Atomics.add(state,0,1);Atomics.wait(state,1,0);
try{const result=createCatalogCampaignService(db).createOperatorInitialCampaign({profile:workerData.profile,campaignName:`race-${workerData.index}`,requestId:`race-${workerData.index}`});parentPort.postMessage({ok:true,id:result.campaignId});}catch(e){parentPort.postMessage({ok:false,code:e.code});}finally{db.close();}}
