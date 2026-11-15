import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Unit {
  id: string;
  code: string;
  name: string;
}

export interface PriceQuote {
  level: number;
  asOf: string;
  priceWithVat: number | null;
  unavailableReason: string | null;
}

export interface ArticleSummary {
  id: string;
  gescomCode: string;
  name: string;
  category: string | null;
  brand: string | null;
  unitCode: string;
  unitName: string;
  tracksLots: boolean;
  isActive: boolean;
  pricesAsOf: string;
  prices: PriceQuote[];
}

export interface ArticleAdmin {
  id: string;
  gescomCode: string;
  name: string;
  category: string | null;
  brand: string | null;
  unitId: string;
  unitCode: string;
  unitName: string;
  tracksLots: boolean;
  isActive: boolean;
  cost: { amount: number; changedAtUtc: string } | null;
  margins: { level: number; marginPercent: number }[];
  vatRates: { id: string; ratePercent: number; validFrom: string; validTo: string | null }[];
}

export interface CreateArticle {
  gescomCode: string;
  name: string;
  unitId: string;
  tracksLots: boolean;
  margins: { level: number; marginPercent: number }[];
  costAmount: number | null;
  category: string | null;
  brand: string | null;
}

export interface VatRateInput {
  ratePercent: number;
  validFrom: string;
  validTo: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  async getUnits(): Promise<Unit[]> {
    return firstValueFrom(this.http.get<Unit[]>('/api/units'));
  }

  async createUnit(code: string, name: string): Promise<void> {
    this.ensureOnline();
    await firstValueFrom(this.http.post('/api/units', { code, name }));
  }

  async getArticles(search = ''): Promise<ArticleSummary[]> {
    return firstValueFrom(
      this.http.get<ArticleSummary[]>('/api/articles', {
        params: search.trim() ? { search: search.trim() } : {},
      }),
    );
  }

  async getAdminArticles(): Promise<ArticleAdmin[]> {
    return firstValueFrom(this.http.get<ArticleAdmin[]>('/api/admin/articles'));
  }

  async createArticle(article: CreateArticle): Promise<void> {
    this.ensureOnline();
    await firstValueFrom(this.http.post('/api/articles', article));
  }

  async updateArticle(article: ArticleAdmin): Promise<void> {
    this.ensureOnline();
    await firstValueFrom(
      this.http.put(`/api/articles/${article.id}`, {
        gescomCode: article.gescomCode,
        name: article.name,
        tracksLots: article.tracksLots,
        isActive: article.isActive,
        category: article.category,
        brand: article.brand,
      }),
    );
  }

  async setCost(articleId: string, amount: number): Promise<void> {
    this.ensureOnline();
    await firstValueFrom(this.http.put(`/api/articles/${articleId}/cost`, { amount }));
  }

  async setMargin(articleId: string, level: number, marginPercent: number): Promise<void> {
    this.ensureOnline();
    await firstValueFrom(
      this.http.put(`/api/articles/${articleId}/margins/${level}`, { marginPercent }),
    );
  }

  async saveVatRate(
    articleId: string,
    vatRateId: string | null,
    rate: VatRateInput,
  ): Promise<void> {
    this.ensureOnline();
    const url = vatRateId
      ? `/api/articles/${articleId}/vat-rates/${vatRateId}`
      : `/api/articles/${articleId}/vat-rates`;
    await firstValueFrom(vatRateId
      ? this.http.put(url, rate)
      : this.http.post(url, rate));
  }

  async createUser(email: string, password: string, isAdmin: boolean): Promise<void> {
    this.ensureOnline();
    await firstValueFrom(this.http.post('/auth/users', { email, password, isAdmin }));
  }

  private ensureOnline(): void {
    if (!navigator.onLine) {
      throw new Error('Sem ligação: as alterações não foram guardadas.');
    }
  }
}
