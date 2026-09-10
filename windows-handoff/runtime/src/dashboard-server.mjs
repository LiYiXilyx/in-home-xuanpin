// Day 6 compatibility wrapper. The implementation now lives under src/server/.
import { startOperationsServer } from './server/index.mjs';

startOperationsServer().catch(error => {
  console.error(error?.stack ?? error);
  process.exitCode=1;
});
