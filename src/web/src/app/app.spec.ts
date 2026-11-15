import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { App } from './app';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: signal(null),
            initialize: async () => {},
            login: async () => {},
            logout: async () => {},
          },
        },
        {
          provide: ApiService,
          useValue: {
            getUnits: async () => [],
            getArticles: async () => [],
            getAdminArticles: async () => [],
          },
        },
      ],
    }).compileComponents();
  });

  it('creates the application shell', () => {
    const fixture = TestBed.createComponent(App);

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the local-account login instead of public registration', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.loading = false;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Iniciar sessão');
    expect(compiled.textContent).toContain('Não existe registo público');
  });

  it('shows the login form and API error when the backend is unavailable', async () => {
    const auth = TestBed.inject(AuthService);
    auth.initialize = async () => {
      throw new Error('API unavailable');
    };

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Iniciar sessão');
    expect(compiled.querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível ligar à aplicação.',
    );
  });

  it('keeps the article grid visible beneath floating windows', () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set({ email: 'admin@example.invalid', isAdmin: true });

    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.loading = false;
    fixture.componentInstance.openWindow('units');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.workspace-home')).toBeTruthy();
    expect(compiled.querySelector('#window-units')).toBeTruthy();
  });

  it('switches static workspace views and filters the main article table', async () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set({ email: 'admin@example.invalid', isAdmin: true });

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.loading = false;
    fixture.detectChanges();
    await fixture.whenStable();

    app.summaries = [
      {
        id: 'article-1',
        gescomCode: 'A-001',
        name: 'Cabo de alimentação',
        category: null,
        brand: null,
        unitCode: 'UN',
        unitName: 'Unidade',
        tracksLots: false,
        isActive: true,
        pricesAsOf: '',
        prices: [],
      },
      {
        id: 'article-2',
        gescomCode: 'B-002',
        name: 'Lâmpada LED',
        category: null,
        brand: null,
        unitCode: 'UN',
        unitName: 'Unidade',
        tracksLots: false,
        isActive: true,
        pricesAsOf: '',
        prices: [],
      },
    ];
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.tabs .tab')).toHaveLength(5);
    expect(compiled.querySelectorAll('.workbench-table tbody tr')).toHaveLength(2);

    (compiled.querySelector('.tabs .tab:nth-child(4)') as HTMLButtonElement).click();
    const filter = compiled.querySelector('#table-filter') as HTMLSelectElement;
    filter.value = 'name';
    filter.dispatchEvent(new Event('change'));
    const search = compiled.querySelector('#table-search') as HTMLInputElement;
    search.value = 'cabo';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(app.activeMainView).toBe('articles');
    expect(app.filteredSummaries.map((article) => article.name)).toEqual(['Cabo de alimentação']);
    expect(compiled.querySelectorAll('.workbench-table tbody tr')).toHaveLength(1);
    expect(compiled.querySelector('.workbench-table tbody')?.textContent).toContain(
      'Cabo de alimentação',
    );
  });

  it('opens, focuses, minimizes, restores, maximizes, and closes workspace windows', () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set({ email: 'admin@example.invalid', isAdmin: true });

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.loading = false;
    app.openWindow('articles');
    app.openWindow('units');

    expect(app.activeWindowId).toBe('units');
    app.focusWindow('articles');
    expect(app.activeWindowId).toBe('articles');

    app.minimizeWindow('articles');
    expect(app.minimizedWindows.map((workspaceWindow) => workspaceWindow.id)).toContain('articles');
    app.restoreWindow('articles');
    expect(app.activeWindowId).toBe('articles');

    app.toggleMaximize('articles');
    expect(
      app.windows.find((workspaceWindow) => workspaceWindow.id === 'articles')?.maximized,
    ).toBe(true);
    app.closeWindow('articles');
    expect(app.windows.map((workspaceWindow) => workspaceWindow.id)).not.toContain('articles');
    expect(app.activeWindowId).toBe('units');
  });

  it('opens customer and supplier windows without exposing unfinished record forms', () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set({ email: 'admin@example.invalid', isAdmin: true });

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.loading = false;
    app.openWindow('customers');
    app.openWindow('suppliers');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(app.activeWindowId).toBe('suppliers');
    expect(compiled.querySelector('#window-customers')).toBeTruthy();
    expect(compiled.querySelector('#window-suppliers')).toBeTruthy();
    expect(compiled.querySelector('#window-customers table')).toBeTruthy();
    expect(compiled.querySelector('#window-suppliers table')).toBeTruthy();
    expect(compiled.querySelector('#window-customers form')).toBeNull();
    expect(compiled.querySelector('#window-suppliers form')).toBeNull();
  });

  it('keeps catalog windows table-only and opens separate creation forms', () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set({ email: 'admin@example.invalid', isAdmin: true });

    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.loading = false;
    app.openWindow('articles');
    app.openWindow('units');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#window-articles table')).toBeTruthy();
    expect(compiled.querySelector('#window-articles input')).toBeNull();
    expect(compiled.querySelector('#window-units table')).toBeTruthy();
    expect(compiled.querySelector('#window-units form')).toBeNull();

    (
      compiled.querySelector('#window-units .view-toolbar .button-primary') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (compiled.querySelector('#window-articles .view-toolbar .button-primary') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('#window-new-unit form input[name="unitCode"]')).toBeTruthy();
    expect(
      compiled.querySelector('#window-new-article form input[name="gescomCode"]'),
    ).toBeTruthy();
  });

  it('does not open administration windows for reader accounts', () => {
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set({ email: 'reader@example.invalid', isAdmin: false });

    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.openWindow('accounts');
    fixture.componentInstance.openWindow('new-unit');
    fixture.componentInstance.openWindow('new-article');

    expect(fixture.componentInstance.windows).toHaveLength(0);
  });

  it('provides a navigable 42-day calendar grid', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const startingMonth = app.calendarMonth.getMonth();

    expect(app.calendarDays).toHaveLength(42);
    app.nextCalendarMonth();
    expect(app.calendarMonth.getMonth()).toBe((startingMonth + 1) % 12);
  });
});
