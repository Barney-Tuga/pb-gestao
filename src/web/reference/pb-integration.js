(function () {
  const api = new window.PbApi();
  const state = { user: null, articles: [], adminArticles: [], units: [] };

  function report(error, element) {
    console.error('Falha na operação:', error);
    const message = error instanceof TypeError
      ? 'Não foi possível contactar o servidor.'
      : error.message;
    if (element) {
      element.textContent = message;
    } else {
      const container = document.getElementById('toast-container');
      const notice = document.createElement('div');
      notice.className = 'toast-item toast-error show';
      notice.textContent = message;
      container.appendChild(notice);
      setTimeout(() => notice.remove(), 6000);
    }
  }

  function tableRow(tbody, values) {
    const row = tbody.insertRow();
    values.forEach((value) => {
      const cell = row.insertCell();
      cell.textContent = value == null ? '—' : String(value);
    });
    return row;
  }

  function articlePrice(article) {
    const price = article.prices.find((item) => item.level === 1)?.priceWithVat;
    return price == null ? '—' : `${Number(price).toFixed(2)} €`;
  }

  function renderArticles() {
    const table = document.querySelector('#table-artigos table');
    const headings = table.querySelectorAll('th');
    ['Código', 'Descrição', 'Unidade', 'Preço N1 · IVA incluído'].forEach((label, index) => {
      headings[index].textContent = label;
    });
    const tbody = table.tBodies[0];
    tbody.replaceChildren();
    state.articles.forEach((article) => {
      const row = tableRow(tbody, [
        article.gescomCode, article.name, article.unitCode, articlePrice(article),
      ]);
      row.addEventListener('dblclick', () => openArticle(article.id));
    });
    if (!state.articles.length) tableRow(tbody, ['Sem artigos disponíveis.', '', '', '']);
    if (typeof filterTable === 'function') filterTable();
  }

  async function refresh() {
    const [articles, units, adminArticles] = await Promise.all([
      api.articles(),
      api.units(),
      state.user.isAdmin ? api.request('/api/admin/articles') : Promise.resolve([]),
    ]);
    state.articles = articles;
    state.adminArticles = adminArticles;
    state.units = units;
    renderArticles();
    document.getElementById('pb-article-count').textContent = String(articles.length);
    document.getElementById('pb-unit-count').textContent = String(units.length);
  }

  function makeWindow(title, content, width = 800, height = 600) {
    const id = openWindow({ title, content, width, height });
    return document.querySelector(`.window[data-id="${id}"]`);
  }

  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'artigo-btn';
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }

  async function openArticles() {
    const win = makeWindow('📦 Artigos', `
      <div class="artigos-toolbar pb-toolbar"></div>
      <div class="pb-window-body">
        <p>Selecione um artigo para consultar a ficha.</p>
        <p class="pb-error" role="alert"></p>
        <div class="pb-table-wrap"><table class="pb-table">
          <thead><tr><th>Código</th><th>Designação</th><th>Unidade</th><th>Preço N1 · IVA incluído</th></tr></thead>
          <tbody></tbody>
        </table></div>
      </div>`);
    const toolbar = win.querySelector('.pb-toolbar');
    if (state.user.isAdmin) {
      toolbar.append(button('➕ Criar', () => openArticle()));
    }
    toolbar.append(button('🔄 Atualizar', () => load()));

    async function load() {
      const error = win.querySelector('.pb-error');
      error.textContent = '';
      try {
        await refresh();
        const tbody = win.querySelector('tbody');
        tbody.replaceChildren();
        const articles = state.user.isAdmin ? state.adminArticles : state.articles;
        articles.forEach((article) => {
          const summary = state.articles.find((item) => item.id === article.id);
          const row = tableRow(tbody, [
            article.gescomCode, article.name, article.unitCode,
            summary ? articlePrice(summary) : 'Inativo',
          ]);
          row.tabIndex = 0;
          row.addEventListener('click', () => openArticle(article.id));
          row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openArticle(article.id);
            }
          });
        });
        if (!articles.length) tableRow(tbody, ['Sem artigos disponíveis.', '', '', '']);
      } catch (errorValue) {
        report(errorValue, error);
      }
    }
    await load();
  }

  function attachArticleWindow(win) {
    const toolbar = win.querySelector('.artigos-toolbar');
    const create = toolbar.querySelector('[title="Criar Novo Artigo"]');
    create.disabled = !state.user.isAdmin;
    create.addEventListener('click', () => openArticle());
    toolbar.querySelector('[title="Procurar Artigo"]').addEventListener('click', openArticles);
    toolbar.querySelector('[title="Alterar Artigo"]').addEventListener('click', openArticles);
    toolbar.querySelector('[title="Atualizar Lista"]').addEventListener('click', async () => {
      try {
        await refresh();
        openArticles();
      } catch (error) {
        report(error);
      }
    });
    ['Eliminar Artigo', 'Imprimir Lista', 'Exportar/Importar Dados'].forEach((title) => {
      toolbar.querySelector(`[title="${title}"]`).addEventListener('click', () => {
        report(new Error('Esta operação ainda não está disponível na API.'));
      });
    });
  }

  async function openArticle(id) {
    const isNew = !id;
    if (isNew && !state.user.isAdmin) return;
    let article = null;
    try {
      if (id) {
        article = state.user.isAdmin
          ? (await api.request('/api/admin/articles')).find((item) => item.id === id)
          : await api.request(`/api/articles/${encodeURIComponent(id)}`);
        if (!article) throw new Error('O artigo já não está disponível.');
      }
    } catch (error) {
      report(error);
      return;
    }

    const win = makeWindow(isNew ? '📦 Novo artigo' : '📦 Ficha de artigo', `
      <div class="pb-window-body">
        <h2>${isNew ? 'Novo artigo' : 'Ficha de artigo'}</h2>
        <p class="pb-error" role="alert"></p><p class="pb-notice" role="status"></p>
        <form class="pb-form pb-article-form">
          <label>Código Gescom<input name="code" maxlength="80" required></label>
          <label>Designação<input name="name" maxlength="200" required></label>
          <label>Unidade<select name="unitId" required></select></label>
          <label>Categoria<input name="category" maxlength="100"></label>
          <label>Marca<input name="brand" maxlength="100"></label>
          <label class="pb-check"><input name="tracksLots" type="checkbox"> Rastrear lotes</label>
          <label class="pb-check pb-active"><input name="isActive" type="checkbox"> Artigo ativo</label>
          <div class="pb-new-fields">
            <label>Custo sem IVA<input name="cost" type="number" min="0" step="0.0001"></label>
            <fieldset><legend>Margem por nível de preço (%)</legend>
              ${[1, 2, 3, 4, 5].map((level) =>
                `<label>Nível ${level}<input name="margin${level}" type="number" step="0.0001" required></label>`
              ).join('')}
            </fieldset>
          </div>
          <button type="submit" class="btn-accent">Guardar</button>
        </form>
        <div class="pb-extra"></div>
      </div>`);
    const form = win.querySelector('.pb-article-form');
    const error = win.querySelector('.pb-error');
    const notice = win.querySelector('.pb-notice');
    const editable = state.user.isAdmin;
    form.elements.code.value = article?.gescomCode ?? '';
    form.elements.name.value = article?.name ?? '';
    form.elements.category.value = article?.category ?? '';
    form.elements.brand.value = article?.brand ?? '';
    form.elements.tracksLots.checked = article?.tracksLots ?? false;
    form.elements.isActive.checked = article?.isActive ?? true;
    win.querySelector('.pb-active').hidden = isNew;
    const newFields = win.querySelector('.pb-new-fields');
    newFields.hidden = !isNew;
    newFields.querySelectorAll('input').forEach((input) => { input.disabled = !isNew; });
    for (const unit of state.units) {
      form.elements.unitId.add(new Option(`${unit.code} — ${unit.name}`, unit.id));
    }
    if (article) {
      const unit = state.units.find((item) => item.code === article.unitCode);
      if (unit) form.elements.unitId.value = unit.id;
    } else {
      form.elements.unitId.insertBefore(new Option('Selecionar unidade', ''), form.elements.unitId.firstChild);
      form.elements.unitId.value = '';
    }
    if (!isNew) form.elements.unitId.disabled = true;
    if (!editable) {
      for (const element of form.elements) element.disabled = true;
      form.querySelector('button').hidden = true;
      win.querySelector('.pb-active').hidden = true;
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      notice.textContent = '';
      const submit = form.querySelector('button');
      submit.disabled = true;
      const base = {
        gescomCode: form.elements.code.value,
        name: form.elements.name.value,
        category: form.elements.category.value || null,
        brand: form.elements.brand.value || null,
        tracksLots: form.elements.tracksLots.checked,
      };
      try {
        if (isNew) {
          await api.request('/api/articles', {
            method: 'POST',
            body: {
              ...base,
              unitId: form.elements.unitId.value,
              costAmount: form.elements.cost.value === '' ? null : Number(form.elements.cost.value),
              margins: [1, 2, 3, 4, 5].map((level) => ({
                level, marginPercent: Number(form.elements[`margin${level}`].value),
              })),
            },
          });
          form.reset();
          notice.textContent = 'Artigo criado.';
        } else {
          await api.request(`/api/articles/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: { ...base, isActive: form.elements.isActive.checked },
          });
          notice.textContent = 'Artigo atualizado.';
        }
        await refresh();
      } catch (errorValue) {
        report(errorValue, error);
      } finally {
        submit.disabled = false;
      }
    });
    if (article && editable) addArticleOperations(win.querySelector('.pb-extra'), article, error, notice);
  }

  function addArticleOperations(container, article, error, notice) {
    container.innerHTML = `
      <form class="pb-form pb-operation" data-operation="cost">
        <h3>Custo sem IVA</h3><label>Novo custo<input name="amount" type="number" min="0" step="0.0001" required></label>
        <button class="btn-accent" type="submit">Guardar custo</button>
      </form>
      <form class="pb-form pb-operation" data-operation="margin">
        <h3>Margem</h3><label>Nível<select name="level">${[1, 2, 3, 4, 5].map((i) => `<option>${i}</option>`).join('')}</select></label>
        <label>Margem (%)<input name="marginPercent" type="number" step="0.0001" required></label>
        <button class="btn-accent" type="submit">Guardar margem</button>
      </form>
      <form class="pb-form pb-operation" data-operation="vat">
        <h3>Taxa de IVA</h3><label>Taxa existente<select name="vatId"><option value="">Nova taxa</option></select></label>
        <label>Taxa (%)<input name="ratePercent" type="number" min="0" step="0.0001" required></label>
        <label>Válida desde<input name="validFrom" type="date" required></label>
        <label>Válida até (exclusivo)<input name="validTo" type="date"></label>
        <button class="btn-accent" type="submit">Guardar taxa</button>
      </form>`;
    const vatForm = container.querySelector('[data-operation="vat"]');
    article.vatRates.forEach((rate) => {
      vatForm.elements.vatId.add(new Option(`${rate.ratePercent}% · ${rate.validFrom}`, rate.id));
    });
    vatForm.elements.vatId.addEventListener('change', () => {
      const rate = article.vatRates.find((value) => value.id === vatForm.elements.vatId.value);
      vatForm.elements.ratePercent.value = rate?.ratePercent ?? '';
      vatForm.elements.validFrom.value = rate?.validFrom ?? '';
      vatForm.elements.validTo.value = rate?.validTo ?? '';
    });
    container.querySelectorAll('form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.textContent = '';
        notice.textContent = '';
        const submit = form.querySelector('button');
        submit.disabled = true;
        const base = `/api/articles/${encodeURIComponent(article.id)}`;
        let path;
        let method = 'PUT';
        let body;
        if (form.dataset.operation === 'cost') {
          path = `${base}/cost`;
          body = { amount: Number(form.elements.amount.value) };
        } else if (form.dataset.operation === 'margin') {
          path = `${base}/margins/${form.elements.level.value}`;
          body = { marginPercent: Number(form.elements.marginPercent.value) };
        } else {
          const vatId = form.elements.vatId.value;
          path = `${base}/vat-rates${vatId ? `/${encodeURIComponent(vatId)}` : ''}`;
          method = vatId ? 'PUT' : 'POST';
          body = {
            ratePercent: Number(form.elements.ratePercent.value),
            validFrom: form.elements.validFrom.value,
            validTo: form.elements.validTo.value || null,
          };
        }
        try {
          await api.request(path, { method, body });
          notice.textContent = 'Alteração guardada.';
          await refresh();
          if (form.dataset.operation === 'vat') {
            const updated = (await api.request('/api/admin/articles')).find((item) => item.id === article.id);
            if (!updated) throw new Error('O artigo já não está disponível.');
            article.vatRates = updated.vatRates;
            vatForm.elements.vatId.replaceChildren(new Option('Nova taxa', ''));
            article.vatRates.forEach((rate) => vatForm.elements.vatId.add(
              new Option(`${rate.ratePercent}% · ${rate.validFrom}`, rate.id),
            ));
            vatForm.reset();
          }
        } catch (errorValue) {
          report(errorValue, error);
        } finally {
          submit.disabled = false;
        }
      });
    });
  }

  function openAccount() {
    const win = makeWindow('👤 Conta', `
      <div class="pb-window-body">
        <h2>Conta local</h2><p class="pb-user"></p><p class="pb-error" role="alert"></p>
        <p class="pb-notice" role="status"></p>
        <button type="button" class="btn-accent pb-logout">Terminar sessão</button>
        <form class="pb-form pb-create-user" hidden>
          <h3>Criar conta</h3>
          <label>Email<input name="email" type="email" required></label>
          <label>Palavra-passe inicial<input name="password" type="password" minlength="12" required autocomplete="new-password"></label>
          <label class="pb-check"><input name="isAdmin" type="checkbox"> Administração</label>
          <button type="submit" class="btn-accent">Criar conta</button>
        </form>
      </div>`, 520, 450);
    win.querySelector('.pb-user').textContent = state.user.email;
    const error = win.querySelector('.pb-error');
    win.querySelector('.pb-logout').addEventListener('click', async () => {
      try {
        await api.logout();
        location.reload();
      } catch (errorValue) {
        report(errorValue, error);
      }
    });
    const form = win.querySelector('.pb-create-user');
    form.hidden = !state.user.isAdmin;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      form.querySelector('button').disabled = true;
      try {
        await api.request('/auth/users', {
          method: 'POST',
          body: {
            email: form.elements.email.value,
            password: form.elements.password.value,
            isAdmin: form.elements.isAdmin.checked,
          },
        });
        form.reset();
        win.querySelector('.pb-notice').textContent = 'Conta criada.';
      } catch (errorValue) {
        report(errorValue, error);
      } finally {
        form.querySelector('button').disabled = false;
      }
    });
  }

  async function start(user) {
    state.user = user;
    document.querySelector('#panel-dashboard .dashboard-hero h1').textContent = 'Bem-vindo ao PB Gestão';
    document.querySelector('#panel-dashboard .dashboard-hero p').textContent =
      'Os restantes módulos apresentam apenas dados de demonstração e não estão ligados à API.';
    const cards = document.querySelector('#panel-dashboard .dashboard-cards');
    cards.innerHTML = `
      <div class="card metric"><div class="card-icon">📦</div><div><div id="pb-article-count" class="metric-value">—</div><div class="metric-label">Artigos</div></div></div>
      <div class="card metric"><div class="card-icon">📏</div><div><div id="pb-unit-count" class="metric-value">—</div><div class="metric-label">Unidades</div></div></div>`;
    document.querySelectorAll('.data-panel:not(#panel-dashboard):not(#table-artigos)').forEach((panel) => {
      const note = document.createElement('p');
      note.className = 'pb-demo-note';
      note.textContent = 'Demonstração: esta área não está ligada à API.';
      panel.prepend(note);
    });
    const articleRows = document.querySelector('#table-artigos tbody');
    articleRows.replaceChildren();
    tableRow(articleRows, ['A carregar artigos…', '', '', '']);
    try {
      await refresh();
    } catch (error) {
      articleRows.replaceChildren();
      tableRow(articleRows, ['Não foi possível carregar os artigos.', '', '', '']);
      report(error);
    }
  }

  window.pbIntegration = { api, start, openArticles, attachArticleWindow, openAccount, report };
})();
