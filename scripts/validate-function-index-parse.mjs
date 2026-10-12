#!/usr/bin/env node
/**
 * Every `exports.<name>` in functions/index.js must map to the module it comes
 * from, read the way the incremental deploy reads it: the deploy refuses to run
 * when one does not (`deploy-functions-incremental.mjs`), so an unmappable
 * export stops the next functions deploy.
 *
 * It asks the deploy's own parser. This file used to carry a copy of it, which
 * would have kept passing after the real one changed.
 */
import { buildExportToFile } from './deploy-functions-resolve.mjs';

const { exportToFile, rawExportNames, parseOk } = buildExportToFile();
console.log(parseOk ? 'OK' : 'FAIL', '| mapped', exportToFile.size, '| raw', rawExportNames.size);
if (!parseOk) {
  const missing = [...rawExportNames].filter((name) => !exportToFile.has(name));
  console.log('Missing from map:', missing.join(', ') || '(none)');
  process.exit(1);
}
