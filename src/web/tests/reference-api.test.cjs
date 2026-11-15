const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const reference = path.join(__dirname, '..', 'reference');
const script = (name) => fs.readFileSync(path.join(reference, name), 'utf8');

function response(status, data = null) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function browser() {
  return new JSDOM(`<!doctype html>
    <div id="toast-container"></div>
    <div id="panel-dashboard" class="data-panel">
      <div class="dashboard-hero"><h1></h1><p></p></div><div class="dashboard-cards"></div>
    </div>
    <div id="table-artigos" class="data-panel">
      <table><thead><tr><th></th><th></th><th></th><th></th></tr></thead><tbody><tr><td>demo</td></tr></tbody></table>
    </div>
    <div id="table-clientes" class="data-panel"></div><div id="window-container"></div>`,
  { url: 'http://localhost:4201/', runScripts: 'outside-only' });
}

async function eventually(predicate) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail('Timed out waiting for the UI');
}

test('login uses API cookies and refreshes the CSRF token after authentication', async () => {
  const dom = browser();
  const { window } = dom;
  const calls = [];
  window.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/auth/csrf') {
      window.document.cookie = `XSRF-TOKEN=token${calls.length}; Path=/`;
      return response(204);
    }
    if (url === '/auth/login') return response(204);
    if (url === '/auth/me') return response(200, { email: 'user@example.invalid', isAdmin: false });
    throw new Error(`Unexpected request: ${url}`);
  };
  window.eval(script('pb-api.js'));
  const user = await new window.PbApi().login('user@example.invalid', 'test-password');
  assert.equal(user.isAdmin, false);
  assert.deepEqual(calls.map((call) => call.url), ['/auth/csrf', '/auth/login', '/auth/csrf', '/auth/me']);
  assert.equal(calls[1].options.headers['X-XSRF-TOKEN'], 'token1');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    email: 'user@example.invalid', password: 'test-password',
  });
  dom.window.close();
});

test('API writes fail offline and do not send a request; server errors remain errors', async () => {
  const dom = browser();
  const { window } = dom;
  let calls = 0;
  window.document.cookie = 'XSRF-TOKEN=token; Path=/';
  window.fetch = async () => { calls++; return response(403); };
  window.eval(script('pb-api.js'));
  const api = new window.PbApi();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
  await assert.rejects(api.request('/api/units', { method: 'POST', body: {} }), /Sem ligação/);
  assert.equal(calls, 0);
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  await assert.rejects(api.request('/api/units', { method: 'POST', body: {} }), (error) => error.status === 403);
  assert.equal(calls, 1);
  dom.window.close();
});

test('article retrieval follows pagination without dropping records', async () => {
  const dom = browser();
  const calls = [];
  dom.window.fetch = async (url) => {
    calls.push(url);
    return response(200, calls.length === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }]);
  };
  dom.window.eval(script('pb-api.js'));
  const articles = await new dom.window.PbApi().articles();
  assert.equal(articles.length, 101);
  assert.deepEqual(calls, ['/api/articles?page=1&pageSize=100', '/api/articles?page=2&pageSize=100']);
  dom.window.close();
});

test('live article table escapes server content and admin can create an article', async () => {
  const dom = browser();
  const { window } = dom;
  const calls = [];
  const articles = [{
    id: 'a1', gescomCode: 'A001', name: '<img src=x onerror=alert(1)>',
    unitCode: 'UN', prices: [{ level: 1, priceWithVat: 1.25 }],
  }];
  const units = [{ id: 'u1', code: 'UN', name: 'Unidade' }];
  window.PbApi = class {
    async articles() { return articles; }
    async units() { return units; }
    async request(url, options) {
      if (url === '/api/admin/articles') return articles;
      calls.push({ url, options });
      return {};
    }
  };
  window.openWindow = ({ content }) => {
    const el = window.document.createElement('div');
    el.className = 'window';
    el.dataset.id = `win-${window.document.querySelectorAll('.window').length + 1}`;
    el.innerHTML = content;
    window.document.getElementById('window-container').append(el);
    return el.dataset.id;
  };
  window.eval(script('pb-integration.js'));
  await window.pbIntegration.start({ isAdmin: true, email: 'admin@example.invalid' });
  assert.equal(window.document.querySelector('#table-artigos tbody img'), null);
  assert.match(window.document.querySelector('#table-artigos tbody').textContent, /<img/);
  await window.pbIntegration.openArticles();
  const list = window.document.querySelector('.window');
  assert.doesNotMatch(list.querySelector('.pb-toolbar').textContent, /Unidades/);
  list.querySelector('.pb-toolbar button').click();
  const form = window.document.querySelector('.pb-article-form');
  form.elements.code.value = 'A002';
  form.elements.name.value = 'Artigo';
  form.elements.unitId.value = 'u1';
  for (let level = 1; level <= 5; level++) form.elements[`margin${level}`].value = String(level);
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await eventually(() => calls.some((call) => call.url === '/api/articles'));
  const sent = calls.find((call) => call.url === '/api/articles');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.body.unitId, 'u1');
  assert.deepEqual(Array.from(sent.options.body.margins, (margin) => margin.marginPercent), [1, 2, 3, 4, 5]);
  dom.window.close();
});

test('reader accounts cannot access article creation', async () => {
  const dom = browser();
  const { window } = dom;
  window.PbApi = class {
    async articles() { return []; }
    async units() { return []; }
  };
  window.openWindow = ({ content }) => {
    const el = window.document.createElement('div');
    el.className = 'window';
    el.dataset.id = 'win-1';
    el.innerHTML = content;
    window.document.body.append(el);
    return 'win-1';
  };
  window.eval(script('pb-integration.js'));
  await window.pbIntegration.start({ isAdmin: false, email: 'reader@example.invalid' });
  await window.pbIntegration.openArticles();
  assert.doesNotMatch(window.document.querySelector('.pb-toolbar').textContent, /Criar/);
  dom.window.close();
});

test('admin can edit an inactive article and change its cost, margin and VAT', async () => {
  const dom = browser();
  const { window } = dom;
  const calls = [];
  const article = {
    id: 'a1', gescomCode: 'A001', name: 'Artigo', unitCode: 'UN',
    category: null, brand: null, tracksLots: false, isActive: false, vatRates: [],
  };
  window.PbApi = class {
    async articles() { return []; }
    async units() { return [{ id: 'u1', code: 'UN', name: 'Unidade' }]; }
    async request(url, options) {
      if (url === '/api/admin/articles') return [article];
      calls.push({ url, options });
      return {};
    }
  };
  window.openWindow = ({ content }) => {
    const el = window.document.createElement('div');
    el.className = 'window';
    el.dataset.id = `win-${window.document.querySelectorAll('.window').length + 1}`;
    el.innerHTML = content;
    window.document.getElementById('window-container').append(el);
    return el.dataset.id;
  };
  window.eval(script('pb-integration.js'));
  await window.pbIntegration.start({ isAdmin: true, email: 'admin@example.invalid' });
  await window.pbIntegration.openArticles();
  window.document.querySelector('.pb-table tbody tr').click();
  await eventually(() => window.document.querySelector('.pb-article-form'));
  const form = window.document.querySelector('.pb-article-form');
  assert.equal(form.checkValidity(), true);
  form.elements.isActive.checked = true;
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await eventually(() => calls.some((call) => call.url === '/api/articles/a1'));
  assert.equal(calls.find((call) => call.url === '/api/articles/a1').options.body.isActive, true);

  const cost = window.document.querySelector('[data-operation="cost"]');
  cost.elements.amount.value = '10.5';
  cost.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await eventually(() => calls.some((call) => call.url === '/api/articles/a1/cost'));
  assert.equal(calls.find((call) => call.url.endsWith('/cost')).options.body.amount, 10.5);

  const margin = window.document.querySelector('[data-operation="margin"]');
  margin.elements.level.value = '3';
  margin.elements.marginPercent.value = '15';
  margin.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await eventually(() => calls.some((call) => call.url === '/api/articles/a1/margins/3'));
  assert.equal(calls.find((call) => call.url.endsWith('/margins/3')).options.body.marginPercent, 15);

  const vat = window.document.querySelector('[data-operation="vat"]');
  vat.elements.ratePercent.value = '23';
  vat.elements.validFrom.value = '2026-01-01';
  vat.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await eventually(() => calls.some((call) => call.url === '/api/articles/a1/vat-rates'));
  const vatCall = calls.find((call) => call.url.endsWith('/vat-rates'));
  assert.equal(vatCall.options.method, 'POST');
  assert.equal(vatCall.options.body.validTo, null);
  dom.window.close();
});

test('catalog loading failure does not display example articles as real records', async () => {
  const dom = browser();
  const { window } = dom;
  window.PbApi = class {
    async articles() { throw new Error('Servidor indisponível'); }
    async units() { return []; }
  };
  window.console.error = () => {};
  window.eval(script('pb-integration.js'));
  await window.pbIntegration.start({ isAdmin: false, email: 'reader@example.invalid' });
  assert.match(window.document.querySelector('#table-artigos tbody').textContent, /Não foi possível carregar/);
  assert.doesNotMatch(window.document.querySelector('#table-artigos tbody').textContent, /demo/);
  dom.window.close();
});

test('reference UI starts only with a server session and renders real articles', async () => {
  const dom = new JSDOM(script('index.html'), {
    url: 'http://localhost:4201/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.console.log = () => {};
  window.fetch = async (url) => {
    if (url === '/auth/csrf') {
      window.document.cookie = 'XSRF-TOKEN=token; Path=/';
      return response(204);
    }
    if (url === '/auth/me') return response(200, { email: 'admin@example.invalid', isAdmin: true });
    if (url === '/api/units') return response(200, [{ id: 'u1', code: 'UN', name: 'Unidade' }]);
    if (url === '/api/admin/articles') {
      return response(200, [
        { id: 'a1', gescomCode: 'CODE', name: 'Artigo real', unitCode: 'UN' },
        { id: 'a2', gescomCode: 'OFF', name: 'Artigo inativo', unitCode: 'UN', isActive: false },
      ]);
    }
    if (url.startsWith('/api/articles?')) {
      return response(200, [{ id: 'a1', gescomCode: 'CODE', name: 'Artigo real', unitCode: 'UN', prices: [] }]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  window.eval(script('pb-api.js'));
  window.eval(script('pb-integration.js'));
  window.eval(script('app.js'));
  await eventually(() => window.document.querySelector('#table-artigos tbody').textContent.includes('Artigo real'));
  assert.equal(window.document.getElementById('login-screen'), null);
  assert.doesNotMatch(window.document.querySelector('#table-artigos tbody').textContent, /Parafuso/);
  window.document.querySelector('.file-btn[data-name="Artigos"]').click();
  const original = window.document.querySelector('.window');
  assert.ok(original.querySelector('.artigos-menu-tabs'));
  original.querySelector('[title="Procurar Artigo"]').click();
  await eventually(() => window.document.querySelector('.pb-table tbody')?.textContent.includes('Artigo real'));
  assert.match(window.document.querySelector('.pb-toolbar').textContent, /Criar/);
  assert.match(window.document.querySelector('.pb-table tbody').textContent, /Artigo inativo/);
  dom.window.close();
});

test('unsupported customer saves do not persist data or report success', async () => {
  const dom = new JSDOM(script('index.html'), {
    url: 'http://localhost:4201/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const messages = [];
  window.console.log = () => {};
  window.showToast = (message) => messages.push(message);
  window.fetch = async (url) => {
    if (url === '/auth/csrf') {
      window.document.cookie = 'XSRF-TOKEN=token; Path=/';
      return response(204);
    }
    if (url === '/auth/me') return response(200, { email: 'admin@example.invalid', isAdmin: true });
    if (url === '/api/units' || url === '/api/admin/articles' || url.startsWith('/api/articles?')) {
      return response(200, []);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  window.eval(script('pb-api.js'));
  window.eval(script('pb-integration.js'));
  window.eval(script('app.js'));
  await eventually(() => window.document.getElementById('login-screen') === null);
  window.document.querySelector('.file-btn[data-name="Clientes"]').click();
  window.document.querySelector('.clientes-toolbar [title="Criar"]').click();
  assert.match(messages.at(-1), /Nada foi guardado/);
  assert.equal(window.localStorage.getItem('demo_clients'), null);
  dom.window.close();
});

test('service worker never intercepts authentication, API requests or writes', () => {
  const handlers = {};
  const context = {
    self: {
      location: { origin: 'http://localhost:4201' },
      addEventListener(name, handler) { handlers[name] = handler; },
    },
    URL,
    fetch() { throw new Error('Unexpected request'); },
    caches: {},
  };
  vm.runInNewContext(script('service-worker.js'), context);
  for (const [url, method] of [
    ['/auth/me', 'GET'], ['/auth', 'GET'], ['/api/articles', 'GET'], ['/api', 'GET'],
    ['/api/articles', 'POST'], ['/index.html', 'POST'], ['https://example.invalid/', 'GET'],
  ]) {
    let intercepted = false;
    handlers.fetch({
      request: { url: new URL(url, 'http://localhost:4201').href, method },
      respondWith() { intercepted = true; },
    });
    assert.equal(intercepted, false, `${method} ${url}`);
  }
});

test('a forged demo session cannot bypass API login', async () => {
  const dom = new JSDOM(script('index.html'), {
    url: 'http://localhost:4201/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.console.log = () => {};
  window.sessionStorage.setItem('pwa_logged', '1');
  window.fetch = async (url) => {
    if (url === '/auth/csrf') {
      window.document.cookie = 'XSRF-TOKEN=token; Path=/';
      return response(204);
    }
    if (url === '/auth/me' || url === '/auth/login') return response(401);
    throw new Error(`Unexpected request: ${url}`);
  };
  window.eval(script('pb-api.js'));
  window.eval(script('pb-integration.js'));
  window.eval(script('app.js'));
  await eventually(() => !window.document.querySelector('#login-form button').disabled);
  assert.ok(window.document.getElementById('login-screen'));
  const form = window.document.getElementById('login-form');
  form.querySelector('#login-username').value = 'demo@example.invalid';
  form.querySelector('#login-password').value = 'incorrect';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await eventually(() => window.document.getElementById('login-error').textContent.length > 0);
  assert.ok(window.document.getElementById('login-screen'));
  dom.window.close();
});
