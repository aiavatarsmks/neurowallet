import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildServer } from '../src/server';

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(() => {
  app = buildServer();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/tx/mock', () => {
  it('returns an array of mock transactions', async () => {
    const res = await supertest(app.server).get('/api/tx/mock').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const tx = res.body[0];
    expect(tx).toHaveProperty('id');
    expect(tx).toHaveProperty('from');
    expect(tx).toHaveProperty('to');
    expect(tx).toHaveProperty('amount');
    expect(tx).toHaveProperty('timestamp');
  });
});