export async function watchClientErrors() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  const sentry = await import('@sentry/react');
  sentry.init({
    dsn,
    release: import.meta.env.VITE_APP_REVISION || 'local',
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [sentry.globalHandlersIntegration()],
    beforeSend(event) {
      return {
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: event.platform,
        release: event.release,
        level: event.level,
        exception: {
          values: event.exception?.values?.map(({ stacktrace }) => ({
            type: 'Error',
            value: 'Diff Service: client error',
            stacktrace: {
              frames: stacktrace?.frames?.map(({ filename, function: name, lineno, colno, in_app }) => ({
                filename: filename?.split(/[?#]/)[0], function: name, lineno, colno, in_app,
              })),
            },
          })),
        },
      };
    },
  });
}
