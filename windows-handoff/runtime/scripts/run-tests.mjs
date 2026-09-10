import { spawnSync } from 'node:child_process';

const aliases = new Map([
  ['catalog-persistence','test/integration/catalog-persistence.test.mjs'],
  ['catalog-resume','test/integration/catalog-resume.test.mjs']
]);
const requested = process.argv.slice(2);
const testArguments = requested.length ? requested.map(value => aliases.get(value) ?? value) : [];
const result = spawnSync(process.execPath,['--test',...testArguments],{ stdio:'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
