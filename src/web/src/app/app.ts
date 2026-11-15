import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from './auth.service';
import { ApiService, ArticleAdmin, ArticleSummary, Unit, VatRateInput } from './api.service';

type WindowId =
  | 'dashboard'
  | 'articles'
  | 'units'
  | 'customers'
  | 'suppliers'
  | 'new-unit'
  | 'new-article'
  | 'article-detail'
  | 'accounts';

type MainViewId = 'dashboard' | 'articles' | 'units' | 'customers' | 'suppliers';
type TableFilterId = 'any' | 'code' | 'name' | 'unit';

interface WorkspaceWindow {
  id: WindowId;
  title: string;
  icon: string;
  width: number;
  height: number;
  x: number;
  y: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
}

interface CalendarDay {
  date: Date;
  dateKey: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

interface WindowDrag {
  id: WindowId;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const WINDOW_DETAILS: Record<
  WindowId,
  { title: string; icon: string; width: number; height: number }
> = {
  dashboard: { title: 'Painel de trabalho', icon: '📊', width: 760, height: 460 },
  articles: { title: 'Artigos', icon: '📦', width: 800, height: 600 },
  units: { title: 'Unidades', icon: '📏', width: 800, height: 520 },
  customers: { title: 'Clientes', icon: '👥', width: 800, height: 520 },
  suppliers: { title: 'Fornecedores', icon: '🏷️', width: 800, height: 520 },
  'new-unit': { title: 'Nova unidade', icon: '+', width: 620, height: 380 },
  'new-article': { title: 'Novo artigo', icon: '+', width: 800, height: 620 },
  'article-detail': { title: 'Ficha do artigo', icon: '▧', width: 960, height: 720 },
  accounts: { title: 'Acessos', icon: '⚙️', width: 680, height: 500 },
};

@Component({
  imports: [CommonModule, FormsModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  @ViewChild('windowStage') private windowStage?: ElementRef<HTMLElement>;

  user = this.auth.currentUser;
  loading = true;
  busy = false;
  error = '';
  notice = '';
  units: Unit[] = [];
  summaries: ArticleSummary[] = [];
  adminArticles: ArticleAdmin[] = [];
  selectedArticleId = '';
  activeMainView: MainViewId = 'dashboard';
  tableSearch = '';
  tableFilter: TableFilterId = 'any';

  loginEmail = '';
  loginPassword = '';
  unitCode = '';
  unitName = '';
  gescomCode = '';
  articleName = '';
  category = '';
  brand = '';
  unitId = '';
  tracksLots = false;
  costAmount = '';
  marginValues = ['', '', '', '', ''];
  updateCostAmount = '';
  selectedMarginLevel = '1';
  updateMarginPercent = '';
  vatRateId = '';
  vatRatePercent = '';
  vatValidFrom = new Date().toISOString().slice(0, 10);
  vatValidTo = '';
  userEmail = '';
  userPassword = '';
  userIsAdmin = false;
  windows: WorkspaceWindow[] = [];
  activeWindowId: WindowId | null = null;
  networkAvailable = typeof navigator === 'undefined' || navigator.onLine;
  calendarMonth = this.startOfMonth(new Date());
  selectedCalendarDate = this.startOfDay(new Date());

  private nextZIndex = 1;
  private windowDrag: WindowDrag | null = null;

  get selectedArticle(): ArticleAdmin | undefined {
    return this.adminArticles.find((article) => article.id === this.selectedArticleId);
  }

  get visibleWindows(): WorkspaceWindow[] {
    return this.windows.filter((workspaceWindow) => !workspaceWindow.minimized);
  }

  get minimizedWindows(): WorkspaceWindow[] {
    return this.windows.filter((workspaceWindow) => workspaceWindow.minimized);
  }

  get activeWindow(): WorkspaceWindow | undefined {
    return this.windows.find((workspaceWindow) => workspaceWindow.id === this.activeWindowId);
  }

  get filteredSummaries(): ArticleSummary[] {
    return this.summaries.filter((article) =>
      this.matchesTableSearch({
        code: article.gescomCode,
        name: [article.name, article.category ?? '', article.brand ?? ''].join(' '),
        unit: [article.unitCode, article.unitName].join(' '),
      }),
    );
  }

  get filteredUnits(): Unit[] {
    return this.units.filter((unit) =>
      this.matchesTableSearch({
        code: unit.code,
        name: unit.name,
        unit: unit.code,
      }),
    );
  }

  get calendarMonthLabel(): string {
    return new Intl.DateTimeFormat('pt-PT', {
      month: 'long',
      year: 'numeric',
    }).format(this.calendarMonth);
  }

  get selectedCalendarDateLabel(): string {
    return new Intl.DateTimeFormat('pt-PT', {
      dateStyle: 'full',
    }).format(this.selectedCalendarDate);
  }

  get calendarDays(): CalendarDay[] {
    const firstOfMonth = this.startOfMonth(this.calendarMonth);
    const leadingDays = (firstOfMonth.getDay() + 6) % 7;
    const today = this.startOfDay(new Date());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        firstOfMonth.getFullYear(),
        firstOfMonth.getMonth(),
        index - leadingDays + 1,
      );
      return {
        date,
        dateKey: this.dateKey(date),
        day: date.getDate(),
        inCurrentMonth: date.getMonth() === firstOfMonth.getMonth(),
        isToday: this.sameDay(date, today),
        isSelected: this.sameDay(date, this.selectedCalendarDate),
      };
    });
  }

  summaryFor(articleId: string): ArticleSummary | undefined {
    return this.summaries.find((article) => article.id === articleId);
  }

  marginFor(article: ArticleAdmin, level: number): number | undefined {
    return article.margins.find((margin) => margin.level === level)?.marginPercent;
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.auth.initialize();
      if (this.user()) {
        await this.loadData();
      }
    } catch {
      this.error = 'Não foi possível ligar à aplicação. Confirme se a API está disponível.';
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async login(): Promise<void> {
    await this.perform(async () => {
      await this.auth.login(this.loginEmail, this.loginPassword);
      this.loginPassword = '';
      await this.loadData();
    });
  }

  async logout(): Promise<void> {
    await this.perform(async () => {
      await this.auth.logout();
      this.units = [];
      this.summaries = [];
      this.adminArticles = [];
      this.selectedArticleId = '';
      this.windows = [];
      this.activeWindowId = null;
      this.activeMainView = 'dashboard';
      this.tableSearch = '';
    });
  }

  setMainView(view: MainViewId): void {
    this.activeMainView = view;
    this.tableSearch = '';
    this.tableFilter = 'any';
  }

  async createUnit(): Promise<void> {
    await this.perform(async () => {
      await this.api.createUnit(this.unitCode, this.unitName);
      this.unitCode = '';
      this.unitName = '';
      await this.refreshCatalog();
      this.closeWindow('new-unit');
      this.notice = 'Unidade criada.';
    });
  }

  async createArticle(): Promise<void> {
    await this.perform(async () => {
      const margins = this.marginValues.map((value, index) => ({
        level: index + 1,
        marginPercent: this.requiredNumber(value, `Margem ${index + 1}`),
      }));
      await this.api.createArticle({
        gescomCode: this.gescomCode,
        name: this.articleName,
        unitId: this.unitId,
        tracksLots: this.tracksLots,
        margins,
        costAmount: this.costAmount.trim() ? this.requiredNumber(this.costAmount, 'Custo') : null,
        category: this.category.trim() || null,
        brand: this.brand.trim() || null,
      });
      this.gescomCode = '';
      this.articleName = '';
      this.category = '';
      this.brand = '';
      this.costAmount = '';
      this.marginValues = ['', '', '', '', ''];
      await this.refreshCatalog();
      this.closeWindow('new-article');
      this.openWindow('articles');
      this.notice = 'Artigo criado.';
    });
  }

  selectArticle(article: ArticleAdmin): void {
    this.selectedArticleId = article.id;
    this.updateCostAmount = '';
    this.updateMarginPercent = '';
    this.vatRateId = '';
    this.vatRatePercent = '';
    this.vatValidFrom = new Date().toISOString().slice(0, 10);
    this.vatValidTo = '';
    this.openWindow('article-detail');
  }

  selectVatRate(rateId: string): void {
    this.vatRateId = rateId;
    const rate = this.selectedArticle?.vatRates.find((value) => value.id === rateId);
    if (rate) {
      this.vatRatePercent = String(rate.ratePercent);
      this.vatValidFrom = rate.validFrom;
      this.vatValidTo = rate.validTo ?? '';
    }
  }

  async saveArticle(): Promise<void> {
    if (!this.selectedArticle) return;
    await this.perform(async () => {
      await this.api.updateArticle(this.selectedArticle!);
      await this.refreshCatalog();
      this.notice = 'Artigo atualizado.';
    });
  }

  async saveCost(): Promise<void> {
    if (!this.selectedArticle) return;
    await this.perform(async () => {
      await this.api.setCost(
        this.selectedArticle!.id,
        this.requiredNumber(this.updateCostAmount, 'Custo'),
      );
      this.updateCostAmount = '';
      await this.refreshCatalog();
      this.notice = 'Custo atualizado e registado no histórico.';
    });
  }

  async saveMargin(): Promise<void> {
    if (!this.selectedArticle) return;
    await this.perform(async () => {
      await this.api.setMargin(
        this.selectedArticle!.id,
        Number(this.selectedMarginLevel),
        this.requiredNumber(this.updateMarginPercent, 'Margem'),
      );
      this.updateMarginPercent = '';
      await this.refreshCatalog();
      this.notice = 'Margem atualizada.';
    });
  }

  async saveVatRate(): Promise<void> {
    if (!this.selectedArticle) return;
    await this.perform(async () => {
      const payload: VatRateInput = {
        ratePercent: this.requiredNumber(this.vatRatePercent, 'Taxa de IVA'),
        validFrom: this.vatValidFrom,
        validTo: this.vatValidTo || null,
      };
      await this.api.saveVatRate(this.selectedArticle!.id, this.vatRateId || null, payload);
      this.vatRateId = '';
      this.vatRatePercent = '';
      this.vatValidTo = '';
      await this.refreshCatalog();
      this.notice = 'Taxa de IVA guardada.';
    });
  }

  async createUser(): Promise<void> {
    await this.perform(async () => {
      await this.api.createUser(this.userEmail, this.userPassword, this.userIsAdmin);
      this.userEmail = '';
      this.userPassword = '';
      this.userIsAdmin = false;
      this.notice = 'Conta local criada.';
    });
  }

  openWindow(id: WindowId): void {
    if (
      (id === 'new-unit' || id === 'new-article' || id === 'article-detail' || id === 'accounts') &&
      !this.user()?.isAdmin
    ) {
      return;
    }
    if (id === 'article-detail' && !this.selectedArticle) return;

    const existing = this.windows.find((workspaceWindow) => workspaceWindow.id === id);
    if (existing) {
      existing.minimized = false;
      this.focusWindow(id);
      return;
    }

    const details = WINDOW_DETAILS[id];
    const offset = (this.windows.length % 5) * 24;
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
    const compact = viewportWidth <= 760;
    const stage = this.windowStage?.nativeElement;
    const stageWidth = stage?.clientWidth || viewportWidth;
    const stageHeight = stage?.clientHeight || viewportHeight;
    const windowWidth = Math.min(details.width, Math.max(0, stageWidth - 24));
    const windowHeight = Math.min(details.height, Math.max(0, stageHeight - 24));
    const maxX = Math.max(12, stageWidth - windowWidth - 12);
    const maxY = Math.max(12, stageHeight - windowHeight - 12);
    const workspaceWindow: WorkspaceWindow = {
      id,
      ...details,
      x: compact ? 8 : Math.min(72 + offset, maxX),
      y: compact ? 8 : Math.min(70 + offset, maxY),
      zIndex: ++this.nextZIndex,
      minimized: false,
      maximized: compact,
    };
    this.windows = [...this.windows, workspaceWindow];
    this.activeWindowId = id;
  }

  focusWindow(id: WindowId): void {
    const workspaceWindow = this.windows.find((item) => item.id === id);
    if (!workspaceWindow) return;
    workspaceWindow.minimized = false;
    if (typeof window !== 'undefined' && window.innerWidth <= 760) {
      workspaceWindow.maximized = true;
    }
    workspaceWindow.zIndex = ++this.nextZIndex;
    this.activeWindowId = id;
  }

  minimizeWindow(id: WindowId): void {
    const workspaceWindow = this.windows.find((item) => item.id === id);
    if (!workspaceWindow) return;
    workspaceWindow.minimized = true;
    if (this.activeWindowId === id) {
      this.activateTopWindow();
    }
  }

  toggleMaximize(id: WindowId): void {
    const workspaceWindow = this.windows.find((item) => item.id === id);
    if (!workspaceWindow) return;
    workspaceWindow.maximized = !workspaceWindow.maximized;
    this.focusWindow(id);
  }

  restoreWindow(id: WindowId): void {
    this.focusWindow(id);
  }

  closeWindow(id: WindowId): void {
    this.windows = this.windows.filter((workspaceWindow) => workspaceWindow.id !== id);
    if (this.activeWindowId === id) {
      this.activateTopWindow();
    }
  }

  startWindowDrag(event: PointerEvent, id: WindowId): void {
    if (event.button !== 0 || typeof window === 'undefined' || window.innerWidth <= 760) {
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest('.window-controls')) {
      return;
    }

    const workspaceWindow = this.windows.find((item) => item.id === id);
    if (!workspaceWindow || workspaceWindow.maximized) return;

    event.preventDefault();
    this.focusWindow(id);
    this.windowDrag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: workspaceWindow.x,
      originY: workspaceWindow.y,
    };
  }

  @HostListener('document:pointermove', ['$event'])
  moveWindow(event: PointerEvent): void {
    if (!this.windowDrag || this.windowDrag.pointerId !== event.pointerId) return;

    const stage = this.windowStage?.nativeElement;
    const workspaceWindow = this.windows.find((item) => item.id === this.windowDrag?.id);
    if (!stage || !workspaceWindow) return;

    const element = stage.querySelector<HTMLElement>(`#window-${workspaceWindow.id}`);
    const maxX = Math.max(0, stage.clientWidth - (element?.offsetWidth ?? 180));
    const maxY = Math.max(0, stage.clientHeight - (element?.offsetHeight ?? 64));
    workspaceWindow.x = Math.min(
      maxX,
      Math.max(0, this.windowDrag.originX + event.clientX - this.windowDrag.startX),
    );
    workspaceWindow.y = Math.min(
      maxY,
      Math.max(0, this.windowDrag.originY + event.clientY - this.windowDrag.startY),
    );
  }

  @HostListener('document:pointerup', ['$event'])
  stopWindowDrag(event: PointerEvent): void {
    if (this.windowDrag?.pointerId === event.pointerId) {
      this.windowDrag = null;
    }
  }

  @HostListener('window:resize')
  maximizeActiveWindowOnCompactViewport(): void {
    if (typeof window === 'undefined' || window.innerWidth > 760) return;
    if (this.activeWindow) {
      this.activeWindow.maximized = true;
    }
  }

  previousCalendarMonth(): void {
    this.calendarMonth = new Date(
      this.calendarMonth.getFullYear(),
      this.calendarMonth.getMonth() - 1,
      1,
    );
  }

  nextCalendarMonth(): void {
    this.calendarMonth = new Date(
      this.calendarMonth.getFullYear(),
      this.calendarMonth.getMonth() + 1,
      1,
    );
  }

  selectCalendarDay(day: CalendarDay): void {
    this.selectedCalendarDate = day.date;
    if (!day.inCurrentMonth) {
      this.calendarMonth = this.startOfMonth(day.date);
    }
  }

  @HostListener('window:online')
  onNetworkOnline(): void {
    this.networkAvailable = true;
  }

  @HostListener('window:offline')
  onNetworkOffline(): void {
    this.networkAvailable = false;
  }

  private async loadData(): Promise<void> {
    this.units = await this.api.getUnits();
    this.summaries = await this.api.getArticles();
    if (this.user()?.isAdmin) {
      await this.refreshCatalog();
    }
  }

  private async refreshCatalog(): Promise<void> {
    const [units, articles, summaries] = await Promise.all([
      this.api.getUnits(),
      this.api.getAdminArticles(),
      this.api.getArticles(),
    ]);
    this.units = units;
    this.adminArticles = articles;
    this.summaries = summaries;
    if (!this.selectedArticleId && articles.length) {
      this.selectedArticleId = articles[0].id;
    }
  }

  private matchesTableSearch(fields: Record<'code' | 'name' | 'unit', string>): boolean {
    const query = this.tableSearch.trim().toLocaleLowerCase('pt-PT');
    if (!query) return true;

    const values = this.tableFilter === 'any' ? Object.values(fields) : [fields[this.tableFilter]];
    return values.some((value) => value.toLocaleLowerCase('pt-PT').includes(query));
  }

  private activateTopWindow(): void {
    const topWindow = this.windows
      .filter((workspaceWindow) => !workspaceWindow.minimized)
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    this.activeWindowId = topWindow?.id ?? null;
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private dateKey(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private sameDay(left: Date, right: Date): boolean {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  private requiredNumber(value: string, label: string): number {
    if (!value.trim() || !Number.isFinite(Number(value))) {
      throw new Error(`${label}: introduza um valor numérico válido.`);
    }
    return Number(value);
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      await action();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.markForCheck();
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && !(error instanceof HttpErrorResponse)) {
      return error.message;
    }
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) return 'Credenciais inválidas ou sessão terminada.';
      if (error.status === 403) return 'A conta não tem permissões para esta operação.';
      if (error.status === 409) {
        return error.error?.error ?? 'A operação entra em conflito com dados existentes.';
      }
      if (error.status === 0) return 'Sem ligação à API; as alterações não foram guardadas.';
      if (error.status === 400) return 'Os dados enviados são inválidos. Verifique os campos.';
    }
    return 'Não foi possível concluir a operação.';
  }
}
