'use strict';

const assert = require('node:assert/strict');

async function main() {
  const base = process.argv[2] || 'http://127.0.0.1:3000';
  const read = async (path) => {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, path);
    return response.json();
  };

  const ready = await read('/ready');
  assert.equal(ready.status, 'ready');
  assert.equal(typeof ready.release, 'string');

  const start = await read('/metrics');
  await read('/health');
  const end = await read('/metrics');
  assert(end.requests >= start.requests + 2);
  assert(end.uptimeSeconds >= start.uptimeSeconds);
  assert(end.memory.rssBytes > 0);
  assert(end.cpu.userSeconds >= start.cpu.userSeconds);
  assert(Number.isInteger(end.serverErrors));

  const page = await fetch(base + '/metrics.html', { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Метрики Diff Service/);
  console.log(JSON.stringify({ ready, metrics: end }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
