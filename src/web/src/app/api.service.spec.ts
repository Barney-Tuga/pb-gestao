import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiService } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('rejects writes while offline without sending a request', async () => {
    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    try {
      await expect(service.createUnit('UN', 'Unidade'))
        .rejects.toThrow('Sem ligação: as alterações não foram guardadas.');
      http.expectNone('/api/units');
    } finally {
      if (onlineDescriptor) {
        Object.defineProperty(navigator, 'onLine', onlineDescriptor);
      }
    }
  });
});
