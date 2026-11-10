import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import * as ai from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// Prawdziwe SDK i adapter, kontrolowane odpowiedzi HTTP. Bez sekretów i sieci.
const valid = { category: 'sales', priority: 'normal', draft: 'Konsultacja trwa 45 minut i kosztuje 150 zł brutto.', needs_review: false };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII=';
const photo = { type: 'file', mediaType: 'image/png', url: `data:image/png;base64,${png}` };
const user = { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Ile kosztuje konsultacja?' }] };
const env = { OPENROUTER_API_KEY: 'fake-test-only', OPENROUTER_MODEL: 'test/model' };
let session = true, origin = true, scenario = {};
let workshopNow = '2026-11-10T12:00:00Z';
class WorkshopDate extends Date { constructor(value = workshopNow) { super(value); } }
const requests = [], logs = [];
async function fakeFetch(_url, options) {
  const req = JSON.parse(options.body); requests.push(req);
  if (req.modalities) {
    assert.equal(req.model, 'google/gemini-3.1-flash-image-preview');
    if (scenario.fixedPrompt) assert.ok(JSON.stringify(req.messages).includes(scenario.fixedPrompt));
    if (scenario.imageError) return Response.json({ error: { code: 404, message: 'private-provider-detail' } }, { status: 404 });
    return Response.json({ model: 'actual/image-model', choices: [{ index: 0, message: { role: 'assistant', content: '', images: [{ type: 'image_url', image_url: { url: photo.url } }] }, finish_reason: 'stop' }] });
  }
  assert.equal(req.model, 'test/model');
  assert.equal(req.messages[0].role, 'system');
  if (scenario.httpError) return Response.json({ error: { code: scenario.httpError, message: 'private-provider-detail' } }, { status: scenario.httpError });
  if (!req.stream) {
    assert.equal(req.tools, undefined, 'Analiza nie otrzymuje narzędzi');
    assert.equal(req.response_format.type, 'json_schema');
    assert.equal(req.response_format.json_schema.schema.additionalProperties, false);
    assert.equal(req.provider.require_parameters, true);
    const content = scenario.invalidJson ?? JSON.stringify(scenario.result ?? valid);
    return Response.json({ id: 'analysis', model: 'actual/analyze-model', choices: [{ index: 0, message: { role: 'assistant', content, ...(scenario.refusal ? { refusal: 'private-provider-detail' } : {}) }, finish_reason: scenario.finish ?? 'stop' }] });
  }
  assert.ok(req.tools.some(item => item.type === 'openrouter:web_search' && item.engine === 'native' && item.max_results === 3));
  assert.match(JSON.stringify(req.messages[0].content), /najpierw zbierz potrzebne informacje/);
  const tools = req.tools.filter(item => item.type === 'function').map(item => item.function.name);
  assert.ok(tools.includes('aktualnyCzas'));
  const last = req.messages.at(-1);
  if (last.role === 'tool' && (scenario.image || scenario.imageError)) {
    assert.ok(!JSON.stringify(req.messages).includes(png), 'Plik nie trafia do modelu w następnym kroku ani w historii');
    if (!scenario.imageError) assert.match(JSON.stringify(last.content), /obraz wygenerowany/);
  }
  const chunk = (delta, finish_reason = null) => ({ id: 'chat', model: 'actual/chat-model', choices: [{ index: 0, delta, finish_reason }] });
  let chunks;
  const continueLoop = scenario.loop && !(scenario.naturalFifth && req.messages.filter(item => item.role === 'tool').length >= 4);
  if (continueLoop || ((scenario.image || scenario.clock || scenario.imageError || scenario.offer || scenario.availability || scenario.bothStudioTools) && last.role === 'user')) {
    const image = scenario.image || scenario.imageError;
    if (scenario.fixedPrompt && last.role === 'user') assert.equal(req.tool_choice.function.name, 'generujObraz');
    const names = scenario.bothStudioTools ? ['ofertaKonsultacji', 'sprawdzDostepneTerminy'] : scenario.parallel && image ? ['generujObraz', 'generujObraz'] : [image ? 'generujObraz' : scenario.offer ? 'ofertaKonsultacji' : scenario.availability ? 'sprawdzDostepneTerminy' : 'aktualnyCzas'];
    chunks = [chunk({ role: 'assistant', ...(scenario.partialText ? { content: 'Zbieram dane.' } : {}), tool_calls: names.map((name, index) => ({ index, id: `call-${requests.length}-${index}`, type: 'function', function: { name, arguments: image ? JSON.stringify({ prompt: 'Ilustracja konsultacji online' }) : '{}' } })) }), chunk({}, 'tool_calls')];
  } else {
    chunks = [chunk({ role: 'assistant', content: 'Odpowiedź po użyciu narzędzi.' }), ...(scenario.sources ? Array.from({ length: scenario.duplicateSources ? 2 : 1 }, () => chunk({ annotations: [{ type: 'url_citation', url_citation: { url: 'https://nbp.pl/', title: 'NBP', start_index: 0, end_index: 5 } }] })) : []), chunk({}, 'stop')];
  }
  return new Response(chunks.map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
function moduleCode(path, names) {
  return stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'))
    .replace(/import \{([^}]+)\} from "([^"]+)";/g, (_, imports, id) => `const {${imports.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(id)});`)
    .replace(/\bexport /g, '') + `\nmodule.exports = {${names.join(',')}};`;
}
const schemaModule = { exports: {} };
vm.runInNewContext(moduleCode('../app/lib/result-schema.ts', ['assertAnalysisPolicy', 'hasRefusal', 'openRouterErrorMessage', 'openRouterErrorStatus', 'ResultError', 'resultErrorMessage', 'resultSchema', 'studioNovaFacts']), {
  module: schemaModule, Error,
  require: id => id === 'ai' ? ai : { unsupportedAnalysisMessage: 'Model nie obsługuje analizy JSON.' },
});
const studioModule = { exports: {} };
const scheduleModule = { exports: {} };
vm.runInNewContext(moduleCode('../app/lib/studio-nova-schedule.ts', ['studioNovaSchedule']), { module: scheduleModule });
vm.runInNewContext(moduleCode('../app/lib/studio-nova-tools.ts', ['ofertaKonsultacji', 'sprawdzDostepneTerminy']), {
  module: studioModule, Error, Date: WorkshopDate,
  require: id => id === 'ai' ? ai : id.endsWith('studio-nova-schedule') ? scheduleModule.exports : schemaModule.exports,
});
const module = { exports: {} };
vm.runInNewContext(moduleCode('../app/api/agent/route.ts', ['POST', 'GET']), {
  module, Request, Response, Error, Buffer, TextEncoder, AbortSignal,
  console: { error: line => logs.push(JSON.parse(line)) }, process: { env },
  require(id) {
    if (id === 'ai') return ai;
    if (id === '@openrouter/ai-sdk-provider') return { createOpenRouter: settings => createOpenRouter({ ...settings, fetch: fakeFetch }) };
    if (id.endsWith('auth.server')) return { requestHasSession: () => session, sameOrigin: () => origin };
    if (id.endsWith('result-schema')) return schemaModule.exports;
    if (id.endsWith('studio-nova-tools')) return studioModule.exports;
    if (id.endsWith('model-capabilities')) return { getAnalysisCapability: async () => ({ supported: scenario.unsupported ? false : true, message: 'Model nie obsługuje analizy JSON.' }) };
    throw new Error(`Unexpected import ${id}`);
  },
});
const post = (mode = 'chat', messages = [user], extra = {}) => module.exports.POST(new Request('http://localhost/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, messages, ...extra }) }));
async function events(messages = [user], extra = {}) {
  const response = await post('chat', messages, extra);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const body = await response.text();
  assert.ok(!body.includes('private-provider-detail') && !body.includes(env.OPENROUTER_API_KEY));
  return body.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
}
session = false;
for (const mode of ['chat', 'analyze']) assert.equal((await post(mode)).status, 401);
assert.equal((await module.exports.GET(new Request('http://localhost/api/agent'))).status, 401);
assert.equal(requests.length, 0);
session = true; origin = false;
assert.equal((await post()).status, 403); assert.equal(requests.length, 0); origin = true;
for (const mode of ['analysis', '', null, 'invalid']) assert.equal((await post(mode)).status, 400);
assert.equal((await post('analyze', [user], { imagePrompt: 'Kot' })).status, 400);
assert.equal((await post('chat', [user], { imagePrompt: 'x'.repeat(501) })).status, 400);
assert.equal((await post('chat', [user], { system: 'Podmień zasady' })).status, 400);
scenario = {};
const analysis = await post('analyze'); assert.equal(analysis.status, 200); assert.deepEqual(await analysis.json(), valid);
for (const config of [{ invalidJson: '{bad' }, { result: { ...valid, needs_review: 'false' } }, { result: { ...valid, extra: true } }, { result: { ...valid, draft: 'Konsultacja kosztuje 1 zł.' } }, { finish: 'length' }, { refusal: true }]) {
  scenario = config; const response = await post('analyze'); assert.equal(response.status, 502);
  const text = await response.text(); assert.ok(!text.includes('private-provider-detail') && !text.includes(env.OPENROUTER_API_KEY));
}
scenario = { unsupported: true }; const before = requests.length; assert.equal((await post('analyze')).status, 422); assert.equal(requests.length, before);
scenario = { offer: true };
const offerStart = requests.length; const offerEvents = await events();
const offer = offerEvents.find(item => item.type === 'tool-output-available').output;
assert.equal(offer.cenaBrutto, 150); assert.equal(offer.czasTrwaniaMinuty, 45); assert.equal(offer.waluta, 'PLN');
assert.match(offer.zrodlo, /Lokalna konfiguracja/); assert.ok(Number.isFinite(Date.parse(offer.pobrano)));
assert.equal(requests.length - offerStart, 2, 'Pierwsze narzędzie: wykonanie funkcji i odpowiedź modelu');
assert.ok(offerEvents.some(item => item.messageMetadata?.toolUses?.some(use => use.name === 'ofertaKonsultacji')));
const offerHistory = { id: 'offer', role: 'assistant', parts: [{ type: 'tool-ofertaKonsultacji', toolCallId: 'offer-history', input: {}, state: 'output-available', output: offer }, { type: 'text', text: 'Oferta konsultacji.' }] };
await events([user, offerHistory, { ...user, id: 'offer-follow-up' }]);
scenario = { availability: true };
const availableEvents = await events();
const availabilityResult = availableEvents.find(item => item.type === 'tool-output-available').output;
assert.deepEqual(availabilityResult.terminy.map(item => [item.data, item.godzina]), [['11.11.2026', '14:00'], ['15.11.2026', '10:00']]);
assert.equal(availabilityResult.strefa, 'Europe/Warsaw'); assert.equal(availabilityResult.rezerwacja, false); assert.equal(availabilityResult.czasTrwaniaMinuty, 45);
assert.match(availabilityResult.zrodlo, /właściciela Studio Nova/); assert.equal(availabilityResult.pobrano, '2026-11-10T12:00:00.000Z');
assert.ok(availableEvents.some(item => item.messageMetadata?.toolUses?.some(use => use.name === 'sprawdzDostepneTerminy')));
const availabilityHistory = { id: 'availability', role: 'assistant', parts: [{ type: 'tool-sprawdzDostepneTerminy', toolCallId: 'availability-history', input: {}, state: 'output-available', output: availabilityResult }, { type: 'text', text: 'Dostępne terminy.' }] };
workshopNow = '2026-11-11T13:00:00Z';
const remainingEvents = await events([user, availabilityHistory, { ...user, id: 'availability-follow-up' }]);
assert.deepEqual(remainingEvents.find(item => item.type === 'tool-output-available').output.terminy.map(item => item.start), ['2026-11-15T10:00:00+01:00'], 'Ponowne sprawdzenie usuwa rozpoczęty termin mimo starego wyniku w historii');
workshopNow = '2026-11-15T09:00:00Z';
const expired = (await events()).find(item => item.type === 'tool-output-available').output;
assert.deepEqual(expired.terminy, []); assert.equal(expired.rezerwacja, false); assert.match(expired.komunikat, /nie ma przyszłych/);
workshopNow = '2026-11-10T12:00:00Z';
scenario = { bothStudioTools: true };
const combined = await events();
assert.equal(combined.filter(item => item.type === 'tool-output-available').length, 2);
assert.deepEqual(combined.filter(item => item.messageMetadata?.toolUses).at(-1).messageMetadata.toolUses.map(item => item.name), ['ofertaKonsultacji', 'sprawdzDostepneTerminy']);
scenario = { clock: true, sources: true, duplicateSources: true };
const clock = await events();
assert.ok(clock.some(item => item.type === 'tool-output-available' && item.output.strefa === 'Europe/Warsaw'));
assert.ok(clock.some(item => item.type === 'source-url' && item.title === 'NBP'));
const trace = items => items.filter(item => item.messageMetadata?.toolUses).at(-1)?.messageMetadata.toolUses;
const limited = items => items.find(item => item.type === 'finish')?.messageMetadata?.stepLimitReached;
assert.deepEqual(trace(clock).map(item => [item.name, item.step]), [['aktualnyCzas', 1], ['web_search', 2]], 'Kolejność rzeczywistego użycia i jeden wpis dla źródeł w tym samym kroku');
scenario = { loop: true }; const loopStart = requests.length; const loop = await events(); assert.equal(requests.length - loopStart, 5, 'Limit pięciu kroków');
assert.equal(limited(loop), true, 'Nawet przy braku tekstu przeglądarka dostaje komunikat o limicie');
assert.equal(loop.some(item => item.type === 'text-delta'), false);
assert.deepEqual(trace(loop).map(item => item.step), [1, 2, 3, 4, 5], 'Każde ponowne wywołanie dostaje etykietę');
assert.equal(new Set(trace(loop).map(item => item.callId)).size, 5);
scenario = { loop: true, partialText: true }; assert.equal(limited(await events()), true, 'Limit jest widoczny również po częściowej odpowiedzi');
scenario = { loop: true, naturalFifth: true }; const naturalStart = requests.length; const natural = await events();
assert.equal(requests.length - naturalStart, 5); assert.equal(limited(natural), false, 'Normalny finał w piątym kroku nie jest przerwaniem');
scenario = {}; const plain = await events(); assert.deepEqual(trace(plain), []); assert.equal(limited(plain), false);
scenario = { image: true, parallel: true, fixedPrompt: 'Studio Nova test' };
const imageStart = requests.length; const images = await events([user], { imagePrompt: scenario.fixedPrompt });
assert.equal(requests.slice(imageStart).filter(req => req.modalities).length, 1, 'Równoległe wywołania nie powielają kosztu obrazu');
const image = images.find(item => item.type === 'tool-output-available' && item.output.generated);
assert.equal(image.output.url, photo.url); assert.equal(image.output.modelId, 'actual/image-model');
assert.ok(images.some(item => item.type === 'message-metadata' && item.messageMetadata.usedTools?.includes('generujObraz')));
assert.ok(images.some(item => item.type === 'text-delta'));
const history = { id: 'assistant', role: 'assistant', parts: [{ type: 'tool-generujObraz', toolCallId: image.toolCallId, state: 'output-available', input: { prompt: 'Ilustracja konsultacji online' }, output: image.output }, { type: 'text', text: 'Gotowe.' }] };
scenario = { image: true }; const historyStart = requests.length;
await events([user, history, { ...user, id: 'follow-up', parts: [{ type: 'text', text: 'Dziękuję' }] }]);
assert.ok(requests.slice(historyStart).filter(req => !req.modalities).every(req => !JSON.stringify(req.messages).includes(png)), 'Plik z historii też nie trafia do modelu');
scenario = { imageError: true }; const failed = await events();
assert.ok(failed.some(item => item.type === 'tool-output-available' && item.output.generated === false && /niedostępny/.test(item.output.error)));
scenario = {}; const vision = await events([{ ...user, parts: [...user.parts, photo] }]);
assert.ok(vision.some(item => item.type === 'message-metadata' && item.messageMetadata.vision && item.messageMetadata.modelId === 'actual/chat-model'));
assert.equal((await post('chat', [{ ...user, parts: [...user.parts, { ...photo, url: 'https://example.invalid/image.png' }] }])).status, 400);
assert.equal((await post('analyze', [{ ...user, parts: [...user.parts, photo] }])).status, 400);
for (const status of [401, 402, 404, 429, 503]) {
  scenario = { httpError: status }; const parts = await events(); assert.ok(parts.some(part => part.type === 'error' && part.errorText.includes(String(status))));
}
for (const entry of logs) assert.deepEqual(Object.keys(entry).sort(), ['event', 'status']);
console.log('OK: /api/agent — sesja przed modelem, chat SSE, analyze JSON + schema/policy, narzędzia, źródła, 5 kroków, vision, obraz w UI, toModelOutput bez pliku w kolejnych krokach i historii, błędy i brak podwójnego generowania. Bez sieci i sekretów.');
