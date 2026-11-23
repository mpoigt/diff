'use strict';

const config = require('../config/env');

const release = process.env.RENDER_GIT_COMMIT || process.env.APP_REVISION || 'local';
const started = process.cpuUsage();
let requests = 0;
let serverErrors = 0;
let pendingLogs = 0;
let sentry;

function safeFrame(frame) {
  return {
    filename: frame.filename?.split(/[\\/]/).pop(),
    function: frame.function,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
  };
}

function getSentry() {
  if (!config.telemetry.sentryDsn) return null;
  if (!sentry) {
    sentry = require('@sentry/node');
    sentry.init({
      dsn: config.telemetry.sentryDsn,
      environment: config.nodeEnv,
      release,
      defaultIntegrations: false,
      sendDefaultPii: false,
      beforeSend(event) {
        return {
          event_id: event.event_id,
          timestamp: event.timestamp,
          environment: event.environment,
          release: event.release,
          platform: event.platform,
          level: event.level,
          tags: event.tags,
          exception: {
            values: event.exception?.values?.map(({ stacktrace }) => ({
              type: 'Error',
              value: 'Diff Service: unexpected error',
              stacktrace: { frames: stacktrace?.frames?.map(safeFrame) },
            })),
          },
        };
      },
    });
  }
  return sentry;
}

function reportError(error, { source, requestId } = {}) {
  const sdk = getSentry();
  if (!sdk) return null;
  return sdk.captureException(error instanceof Error ? error : new Error('Unhandled rejection'), {
    tags: { source, ...(requestId ? { requestId } : {}) },
  });
}

async function flushErrors() {
  return getSentry()?.flush(2000);
}

async function sendOperationalLog(event, fields = {}) {
  const { logsUrl, logsToken } = config.telemetry;
  if (!logsUrl || !logsToken || pendingLogs >= 8) return false;

  pendingLogs += 1;
  try {
    const response = await fetch(logsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${logsToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, message: event, dt: new Date().toISOString(), release }),
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  } finally {
    pendingLogs -= 1;
  }
}

function observeHttp(req, res, next) {
  res.once('finish', () => {
    requests += 1;
    if (res.statusCode >= 500) serverErrors += 1;
    if (res.statusCode >= 400) {
      void sendOperationalLog('http.response', {
        method: req.method,
        status: res.statusCode,
      });
    }
  });
  next();
}

function metrics() {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage(started);
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    requests,
    serverErrors,
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
    cpu: { userSeconds: cpu.user / 1e6, systemSeconds: cpu.system / 1e6 },
    release,
  };
}

module.exports = { reportError, flushErrors, sendOperationalLog, observeHttp, metrics, release };
