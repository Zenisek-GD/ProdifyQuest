const test = require('node:test');
const assert = require('node:assert/strict');
const { deploymentOrigin, checkDeployment } = require('../scripts/check-deployment.cjs');

test('release API configuration requires a public HTTPS origin', () => {
  assert.equal(deploymentOrigin(' https://api.example.com/ '), 'https://api.example.com');
  for (const invalid of [undefined, '', 'not a URL', 'http://api.example.com', 'https://api.example.com/api',
    'https://api.example.com/health', 'https://api.example.com?token=abc', 'https://api.example.com#fragment',
    'https://user:password@api.example.com', 'https://localhost', 'https://192.168.123.39',
    'https://10.0.2.2', 'https://127.1', 'https://172.16.0.1', 'https://[::1]', 'https://[fd00::1]']) {
    assert.throws(() => deploymentOrigin(invalid));
  }
});

test('static website fallback with HTTP 200 is rejected', async () => {
  await assert.rejects(checkDeployment('https://frontend.example.com', async () =>
    new Response('<!doctype html><title>ProdifyQuest</title>', { headers: { 'content-type': 'text/html' } })),
  /returns a webpage.*Node Web Service/);
});

test('only this backend health signature passes; checks do not send credentials', async () => {
  const origin = await checkDeployment('https://api.example.com/', async (url, options) => {
    assert.equal(url, 'https://api.example.com/health');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.body, undefined);
    assert.equal(options.signal.aborted, false);
    return Response.json({ status: 'ok', service: 'ProdifyQuest API' });
  });
  assert.equal(origin, 'https://api.example.com');
  for (const payload of [{ status: 'ok' }, { status: 'error', service: 'ProdifyQuest API' }, null]) {
    await assert.rejects(checkDeployment(origin, async () => Response.json(payload)), /does not identify/);
  }
});

test('network, HTTP and malformed JSON failures have deployment instructions', async () => {
  await assert.rejects(checkDeployment('https://api.example.com', async () => { throw new Error('network'); }), /Cannot reach/);
  await assert.rejects(checkDeployment('https://api.example.com', async () => new Response('', { status: 503 })), /HTTP 503/);
  await assert.rejects(checkDeployment('https://api.example.com', async () =>
    new Response('invalid', { headers: { 'content-type': 'application/json' } })), /invalid JSON/);
});
