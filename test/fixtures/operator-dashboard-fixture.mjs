import fs from 'node:fs';
import http from 'node:http';

const options=parseArgs(process.argv.slice(2));
if (options.counter) fs.appendFileSync(options.counter,`${process.pid}\n`);
if (options.pidFile) fs.writeFileSync(options.pidFile,String(process.pid));
if (options.mode === 'exit') {
  process.stderr.write('fixture requested startup failure\n');
  process.exit(23);
}

const body=options.mode === 'foreign'
  ? { ok:true,service:'foreign-service',apiVersion:1,environment:'fixture',testMode:true }
  : { ok:true,service:'temu-operator-dashboard',apiVersion:1,environment:'fixture',testMode:true };
const server=http.createServer((request,response) => {
  if (request.url !== '/api/health') {
    response.writeHead(404,{ 'Content-Type':'application/json' });
    response.end(JSON.stringify({ ok:false }));
    return;
  }
  response.writeHead(200,{ 'Content-Type':'application/json' });
  response.end(JSON.stringify(body));
});
server.listen(Number(options.port),'127.0.0.1');
const shutdown=() => server.close(() => process.exit(0));
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);

function parseArgs(args) {
  const parsed={ mode:'valid' };
  for (let index=0;index<args.length;index+=2) parsed[args[index].replace(/^--/,'').replace(/-([a-z])/g,(_match,letter) => letter.toUpperCase())]=args[index+1];
  return parsed;
}
