import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export async function loadArtifactTool() {
  const dependencyRoot=process.env.TEMU_ARTIFACT_NODE_MODULES;
  if (!dependencyRoot) return import('@oai/artifact-tool');
  const requireFromBundle=createRequire(path.join(path.resolve(dependencyRoot),'package.json'));
  const entry=requireFromBundle.resolve('@oai/artifact-tool');
  return import(pathToFileURL(entry).href);
}
