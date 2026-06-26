import Fastify, { FastifyInstance } from 'fastify';

/**
 * Build a Fastify server instance with all routes registered. Exported
 * separately to allow reuse in tests.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify();

  // Mock transaction endpoint. Returns an array of fake transactions.
  app.get('/api/tx/mock', async (_request, _reply) => {
    return [
      {
        id: '0x1',
        from: '0xabc123',
        to: '0xdef456',
        amount: 0.5,
        timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      },
      {
        id: '0x2',
        from: '0xabc123',
        to: '0xghi789',
        amount: 1.2,
        timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      },
      {
        id: '0x3',
        from: '0xdef456',
        to: '0xabc123',
        amount: 0.75,
        timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
      },
    ];
  });

  return app;
}

/**
 * Only start listening when this file is executed directly. When imported
 * by tests the server is not started automatically.
 */
export async function start() {
  const app = buildServer();
  const port = Number(process.env.PORT) || 3001;
  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Backend listening on port ${port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// When executed via `npm run dev` or `node src/server.ts`, automatically start
// the server. During tests the NODE_ENV is set to 'test' and the server
// will not listen on a port until explicitly started.
if (process.env.NODE_ENV !== 'test') {
  // eslint-disable-next-line no-floating-promises
  start();
}
