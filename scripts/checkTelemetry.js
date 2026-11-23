'use strict';

const { reportError, flushErrors, sendOperationalLog } = require('../src/services/telemetry');

async function main() {
  const eventId = reportError(new Error('Diff Service telemetry check'), { source: 'manual-check' });
  const [errorsSent, logSent] = await Promise.all([
    eventId ? flushErrors() : false,
    sendOperationalLog('telemetry.check'),
  ]);
  console.log('Sentry:', eventId && errorsSent ? `event ${eventId} queued and flushed` : 'not confirmed');
  console.log('Better Stack:', logSent ? 'accepted' : 'not confirmed');
  if (!eventId || !errorsSent || !logSent) process.exitCode = 1;
}

main().catch(() => {
  console.error('Telemetry check failed.');
  process.exitCode = 1;
});
