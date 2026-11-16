import fs from 'node:fs';
import ts from '../../client/node_modules/typescript/lib/typescript.js';
const source = ts.transpileModule(fs.readFileSync(new URL('../../client/utils/imageReadRetry.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
export const imageReadRetryModuleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
