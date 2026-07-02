import type { NextApiRequest, NextApiResponse } from 'next';

/** Minimal NextApiRequest stub for handler unit tests. */
export function mockReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    method: 'GET',
    headers: {},
    query: {},
    body: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as NextApiRequest;
}

export interface MockRes extends NextApiResponse {
  statusCode: number;
  jsonBody: unknown;
}

/** Minimal NextApiResponse stub capturing status code and JSON body. */
export function mockRes(): MockRes {
  const res = {
    statusCode: 0,
    jsonBody: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
    end() {
      return res;
    },
  };
  return res as unknown as MockRes;
}
