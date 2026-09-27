// Runs before cloud dependencies are installed, so use Node built-ins only.
const { isIP } = require('node:net');

function deploymentOrigin(value) {
  if (!value?.trim()) {
    throw new Error('EXPO_PUBLIC_API_URL is missing. Set it in the EAS environment selected by eas.json (preview for APKs).');
  }
  let url;
  try { url = new URL(value.trim()); } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid public HTTPS origin.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('EXPO_PUBLIC_API_URL must be an HTTPS origin only, without /api, another path, credentials, or query parameters.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ipv4 = isIP(host) === 4 ? host.split('.').map(Number) : null;
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    (ipv4 && (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 ||
      (ipv4[0] === 169 && ipv4[1] === 254) || (ipv4[0] === 192 && ipv4[1] === 168) ||
      (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31))) ||
    (isIP(host) === 6 && (host === '::' || host === '::1' || /^(fc|fd|fe[89ab])/.test(host)));
  if (local) throw new Error('EXPO_PUBLIC_API_URL points to a local address. Distributed APKs need the deployed backend HTTPS origin.');
  return url.origin;
}

async function checkDeployment(value, fetchImpl = fetch) {
  const origin = deploymentOrigin(value);
  let response;
  try {
    response = await fetchImpl(`${origin}/health`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw new Error(`Cannot reach ${origin}/health within 55 seconds. Check the backend deploy logs, HTTPS address, and whether the hosting service is still starting.`);
  }
  if (!response.ok) throw new Error(`Backend health check returned HTTP ${response.status}. Fix the backend deployment before building the APK.`);
  const type = response.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('application/json')) {
    throw new Error(`${origin}/health returns a webpage instead of the ProdifyQuest API. Deploy prodify-backend as a Node Web Service and use that service's URL, not the frontend website URL.`);
  }
  let health;
  try { health = await response.json(); } catch {
    throw new Error('Backend health check returned invalid JSON. Check that this URL belongs to prodify-backend.');
  }
  if (health?.status !== 'ok' || health?.service !== 'ProdifyQuest API') {
    throw new Error('This URL does not identify a healthy ProdifyQuest API. Check the deployed backend service.');
  }
  return origin;
}

if (require.main === module) {
  checkDeployment(process.argv[2] || process.env.EXPO_PUBLIC_API_URL).then(origin => {
    console.log(`ProdifyQuest API reachable: ${origin}`);
    console.log('HTTP deployment check passed. Verify Firebase sign-in separately before distributing the app.');
  }).catch(error => {
    console.error(`Deployment check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { deploymentOrigin, checkDeployment };
