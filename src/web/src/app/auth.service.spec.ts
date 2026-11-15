import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('refreshes the antiforgery token after login changes identity', async () => {
    const login = service.login('admin@example.invalid', 'StrongPassword!123');

    http.expectOne('/auth/csrf').flush(null);
    await Promise.resolve();
    http.expectOne('/auth/login').flush(null);
    await Promise.resolve();
    http.expectOne('/auth/csrf').flush(null);
    await Promise.resolve();
    http.expectOne('/auth/me').flush({
      email: 'admin@example.invalid',
      isAdmin: true,
    });

    await login;
    expect(service.currentUser()).toEqual({
      email: 'admin@example.invalid',
      isAdmin: true,
    });
  });
});
