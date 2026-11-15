(function () {
  class ApiError extends Error {
    constructor(status) {
      super(
        status === 401
          ? 'Sessão inválida ou expirada.'
          : status === 403
            ? 'Não tem permissão para esta operação.'
            : status === 409
              ? 'O registo já existe ou os dados entram em conflito.'
              : status === 400
                ? 'Não foi possível validar os dados enviados.'
                : `O servidor respondeu com o erro ${status}.`,
      );
      this.status = status;
    }
  }

  class PbApi {
    async request(path, { method = 'GET', body } = {}) {
      const write = !['GET', 'HEAD'].includes(method);
      if (write && !navigator.onLine) {
        throw new Error('Sem ligação: as alterações não foram guardadas.');
      }

      const headers = {};
      if (write) {
        const token = document.cookie
          .split('; ')
          .find((cookie) => cookie.startsWith('XSRF-TOKEN='));
        if (!token) throw new Error('Não foi possível validar a sessão. Atualize a página.');
        headers['X-XSRF-TOKEN'] = decodeURIComponent(token.slice('XSRF-TOKEN='.length));
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new ApiError(response.status);
      if (response.status === 204) return null;
      return response.json();
    }

    async csrf() {
      await this.request('/auth/csrf');
    }

    async currentUser() {
      return this.request('/auth/me');
    }

    async login(email, password) {
      await this.csrf();
      await this.request('/auth/login', { method: 'POST', body: { email, password } });
      await this.csrf();
      return this.currentUser();
    }

    async logout() {
      await this.request('/auth/logout', { method: 'POST' });
    }

    async articles() {
      const result = [];
      for (let page = 1; ; page++) {
        const items = await this.request(`/api/articles?page=${page}&pageSize=100`);
        result.push(...items);
        if (items.length < 100) return result;
      }
    }

    units() {
      return this.request('/api/units');
    }
  }

  window.PbApi = PbApi;
  window.PbApiError = ApiError;
})();
