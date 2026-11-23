if (process.env.NETLIFY === 'true') {
  const backend = new URL(process.env.VITE_API_URL ?? '');
  if (backend.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(backend.hostname)) {
    throw new Error('VITE_API_URL must point to the HTTPS backend in the Netlify build.');
  }
}
