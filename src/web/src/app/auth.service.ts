import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface CurrentUser {
  email: string;
  isAdmin: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly currentUser = signal<CurrentUser | null>(null);

  async initialize(): Promise<void> {
    await firstValueFrom(this.http.get<void>('/auth/csrf'));
    try {
      this.currentUser.set(await firstValueFrom(this.http.get<CurrentUser>('/auth/me')));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.currentUser.set(null);
        return;
      }

      throw error;
    }
  }

  async login(email: string, password: string): Promise<void> {
    await firstValueFrom(this.http.get<void>('/auth/csrf'));
    await firstValueFrom(this.http.post<void>('/auth/login', { email, password }));
    await firstValueFrom(this.http.get<void>('/auth/csrf'));
    this.currentUser.set(await firstValueFrom(this.http.get<CurrentUser>('/auth/me')));
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post<void>('/auth/logout', {}));
    this.currentUser.set(null);
  }
}
