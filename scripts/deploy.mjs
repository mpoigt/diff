import { setTimeout as delay } from 'node:timers/promises';

const config = process.env;
const release = config.GITHUB_SHA;
const branch = config.GITHUB_REF_NAME;

function checkedUrl(name) {
  const value = config[name];
  if (!value) throw new Error(`Set ${name} before enabling deploy.`);
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`);
  return url;
}

async function trigger(label, url) {
  try {
    const r = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    await r.body?.cancel();
    if (r.ok) return;
  } catch {
    // Log the operation only, because the URL contains a deploy secret.
  }
  throw new Error(`${label} did not accept its deploy hook.`);
}

async function verify(label, url, isReady) {
  url.searchParams.set('revision', release);
  for (let i = 0; i < 28; i += 1) {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (r.ok && isReady(await r.json())) {
        console.log(`${label} is serving ${release}.`);
        return;
      }
    } catch {
      // A new instance may be starting or may still be serving the old revision.
    }
    await delay(10_000);
  }
  throw new Error(`${label} did not serve the expected revision.`);
}

async function main() {
  if (!/^[a-f0-9]{40}$/.test(release) || !branch) throw new Error('Missing GitHub revision or branch.');
  const render = checkedUrl('RENDER_DEPLOY_HOOK');
  const netlify = checkedUrl('NETLIFY_BUILD_HOOK');
  const backend = checkedUrl('BACKEND_URL');
  const frontend = checkedUrl('FRONTEND_URL');
  render.searchParams.set('ref', release);
  netlify.searchParams.set('trigger_branch', branch);

  await trigger('Render', render);
  await verify('Render', new URL('/ready', backend), (data) => data.status === 'ready' && data.release === release);
  await trigger('Netlify', netlify);
  await verify('Netlify', new URL('/version.json', frontend), (data) => data.release === release);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
