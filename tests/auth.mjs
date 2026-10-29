import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { authConfigured, createSession, verifySession, cookieOptions } from '../app/lib/auth.server.ts';

// Własne dane testowe; bez wczytywania istniejących sekretów.
process.env.CHAT_PASSWORD = 'local-test-password';
process.env.SESSION_SECRET = randomBytes(48).toString('base64url');
process.env.OPENROUTER_API_KEY = '';
process.env.OPENROUTER_MODEL = '';
process.env.NODE_ENV = 'production';
assert.equal(cookieOptions().secure, true);
const token = createSession();
assert.ok(verifySession(token));
assert.equal(verifySession(token, Date.now() + 7_201_000), false);
assert.equal(verifySession(token + 'x'), false);
assert.equal(verifySession('bad'), false);
process.env.CHAT_PASSWORD = '';
assert.equal(authConfigured(), false);
assert.equal(verifySession(token), false);
process.env.CHAT_PASSWORD = 'local-test-password';

const base = 'http://127.0.0.1:3001';
async function withServer(overrides, run) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3001'], {
    env: { ...process.env, ...overrides }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  child.stdout.on('data', data => { if (data.toString().includes('Ready')) ready = true; });
  child.stderr.on('data', () => {});
  try {
    for (let i = 0; i < 100 && !ready && child.exitCode === null; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(ready, 'Serwer testowy nie wystartował');
    await run();
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
}
const login = password => fetch(base + '/api/session', {
  method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ password }),
});
const chat = cookie => fetch(base + '/api/chat', {
  method: 'POST', headers: { origin: base, ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [] }),
});

await withServer({}, async () => {
  assert.match(await (await fetch(base)).text(), /Wpisz hasło/);
  assert.equal((await chat()).status, 401);
  assert.equal((await chat('chat_session=forged')).status, 401);
  assert.equal((await login('wrong')).status, 401);
  const response = await login('local-test-password');
  assert.equal(response.status, 204);
  const setCookie = response.headers.get('set-cookie');
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=strict', 'Max-Age=7200']) {
    assert.ok(setCookie.toLowerCase().includes(attribute.toLowerCase()));
  }
  const cookie = setCookie.split(';')[0];
  assert.ok(!cookie.includes('local-test-password'));
  assert.match(await (await fetch(base, { headers: { cookie } })).text(), /Mój chatbot/);
  assert.equal((await chat(cookie)).status, 503); // OpenRouter wyłączony: nie ma wywołania modelu.
  const logout = await fetch(base + '/api/session', { method: 'DELETE', headers: { origin: base, cookie } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal((await chat()).status, 401);
  const foreign = await fetch(base + '/api/session', {
    method: 'POST', headers: { origin: 'https://foreign.invalid', 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(foreign.status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await login('wrong')).status, 401);
  const limited = await login('wrong');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
await withServer({ CHAT_PASSWORD: '' }, async () => {
  assert.equal((await login('local-test-password')).status, 503);
  assert.equal((await chat()).status, 401);
  assert.match(await (await fetch(base)).text(), /Dostęp zablokowany/);
});
await withServer({ SESSION_SECRET: '' }, async () => {
  assert.equal((await login('local-test-password')).status, 503);
  assert.equal((await chat()).status, 401);
});
console.log('OK: poprawne/błędne hasło, cookie, wygaśnięcie/podpis, wyjście, 401, brak konfiguracji, Origin i 429. Bez wywołań OpenRouter.');
