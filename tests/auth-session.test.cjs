/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const axios = require('axios');

const project = path.resolve(__dirname, '..');
const tokens = (name, expiresIn = 3600) => ({
  idToken: `id-${name}`, refreshToken: `refresh-${name}`, expiresIn,
});

function evaluate(filename, replacements) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(project, filename), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => replacements[name] ?? require(name),
    process: { env: {} }, __DEV__: true, Date, Error, Promise, Set, console,
  }, { filename });
  return module.exports;
}

function fixture(t) {
  const transports = [];
  const client = evaluate('scripts/api.ts', {
    'react-native': { Platform: { OS: 'web' } },
    axios: {
      ...axios,
      create(options) {
        const transport = axios.create(options);
        transports.push(transport);
        return transport;
      },
    },
  });

  // Both real Axios instances use deferred local adapters. No network calls occur.
  const requests = [];
  for (const transport of transports) {
    transport.defaults.adapter = config => new Promise((resolve, reject) => {
      requests.push({
        config,
        resolve: data => resolve({ config, data, status: 200, statusText: 'OK', headers: {} }),
        unauthorized: () => reject(new axios.AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
          config, status: 401, data: {}, headers: {},
        })),
      });
    });
  }
  const take = async url => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const index = requests.findIndex(request => request.config.url === url);
      if (index >= 0) return requests.splice(index, 1)[0];
      await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`Expected a request to ${url}`);
  };

  // Exercise AuthProvider's asynchronous state changes without a native renderer.
  // Hook state and effects are retained for this one mounted provider instance.
  const states = [];
  const cleanups = [];
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useCallback: callback => callback,
    useRef: value => ({ current: value }),
    useContext: () => null,
    useState(value) {
      const index = states.length;
      states.push(value);
      return [value, next => { states[index] = next; }];
    },
    useEffect(callback) { cleanups.push(callback()); },
    createElement: (type, props) => ({ type, props }),
  };
  const context = evaluate('context/auth.tsx', {
    react,
    '@/scripts/api': client,
    '@react-native-async-storage/async-storage': { multiRemove: async () => {} },
  });
  const actions = context.AuthProvider({ children: null }).props.value;
  t.after(() => {
    cleanups.forEach(cleanup => cleanup?.());
    assert.equal(requests.length, 0, 'Unexpected requests remain in the local adapter queue');
  });
  return { client, actions, take, requests, user: () => states[0] };
}

test('an old 401 cannot replay a mutation with a new account token', { timeout: 10000 }, async t => {
  const { client, take, requests } = fixture(t);
  client.setSession(tokens('old'));
  const pending = client.api.post('/tasks', { title: 'Old task' });
  const rejected = assert.rejects(pending, /session changed/);
  const old = await take('/tasks');
  assert.equal(old.config.headers.get('Authorization'), 'Bearer id-old');
  client.setSession(tokens('new'));
  old.unauthorized();
  await rejected;
  assert.equal(requests.length, 0, 'The stale 401 must not trigger a refresh or replay');
  const next = client.api.get('/me');
  const request = await take('/me');
  assert.equal(request.config.headers.get('Authorization'), 'Bearer id-new');
  request.resolve({ user: { id: 'new' } });
  await next;
});

test('a successful response from a cleared session is discarded', { timeout: 10000 }, async t => {
  const { client, take } = fixture(t);
  client.setSession(tokens('old'));
  const pending = client.api.get('/me');
  const rejected = assert.rejects(pending, /session changed/);
  const request = await take('/me');
  client.clearSession();
  request.resolve({ user: { id: 'old' } });
  await rejected;
});

test('old refresh completion cannot replace or clear the new account refresh', { timeout: 10000 }, async t => {
  const { client, take, requests } = fixture(t);
  client.setSession(tokens('old', 1));
  const oldPending = client.api.get('/me');
  const rejected = assert.rejects(oldPending, /session changed/);
  const oldRefresh = await take('/auth/refresh');
  client.setSession(tokens('new', 1));
  const newPending = client.api.get('/me');
  const newRefresh = await take('/auth/refresh');
  assert.equal(JSON.parse(newRefresh.config.data).refreshToken, 'refresh-new');
  oldRefresh.resolve(tokens('old-refreshed'));
  await rejected;
  const secondNewPending = client.api.get('/me');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 0, 'Requests for the new account must share its pending refresh');
  newRefresh.resolve(tokens('new-refreshed'));
  for (const request of [await take('/me'), await take('/me')]) {
    assert.equal(request.config.headers.get('Authorization'), 'Bearer id-new-refreshed');
    request.resolve({ user: { id: 'new' } });
  }
  await Promise.all([newPending, secondNewPending]);
});

test('only the latest sign-in attempt can establish a session', { timeout: 10000 }, async t => {
  const { actions, take, user } = fixture(t);
  const first = actions.signIn('old@example.com', 'password');
  const rejected = assert.rejects(first, /sign-in attempt changed/);
  const firstLogin = await take('/auth/login');
  const second = actions.signIn('new@example.com', 'password');
  (await take('/auth/login')).resolve(tokens('new'));
  (await take('/me')).resolve({ user: { id: 'new' } });
  await second;
  firstLogin.resolve(tokens('old'));
  await rejected;
  assert.equal(user().id, 'new');
});

test('an old logout completion cannot clear a newer login', { timeout: 10000 }, async t => {
  const { client, actions, take, user } = fixture(t);
  client.setSession(tokens('old'));
  const logout = actions.signOut();
  const rejected = assert.rejects(logout, /session changed/);
  const oldLogout = await take('/auth/logout');
  const login = actions.signIn('next@example.com', 'password');
  (await take('/auth/login')).resolve(tokens('next'));
  (await take('/me')).resolve({ user: { id: 'next' } });
  await login;
  oldLogout.resolve({ message: 'Signed out' });
  await rejected;
  assert.equal(user().id, 'next');
  const check = client.api.get('/me');
  const request = await take('/me');
  assert.equal(request.config.headers.get('Authorization'), 'Bearer id-next');
  request.resolve({ user: { id: 'next' } });
  await check;
});

test('a delayed profile response cannot restore the user after logout', { timeout: 10000 }, async t => {
  const { client, actions, take, user } = fixture(t);
  client.setSession(tokens('active'));
  const initial = actions.refreshUser();
  (await take('/me')).resolve({ user: { id: 'active' } });
  await initial;
  assert.equal(user().id, 'active');
  const profile = actions.refreshUser();
  const rejected = assert.rejects(profile, /session changed/);
  const profileRequest = await take('/me');
  const logout = actions.signOut();
  (await take('/auth/logout')).resolve({ message: 'Signed out' });
  await logout;
  profileRequest.resolve({ user: { id: 'active' } });
  await rejected;
  assert.equal(user(), null);
});
