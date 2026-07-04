import { parseRedisConnection } from './deploy-queue';

describe('parseRedisConnection', () => {
  it('parses host and port from a redis URL', () => {
    expect(parseRedisConnection('redis://localhost:6379')).toMatchObject({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    });
  });

  it('defaults the port to 6379 when omitted', () => {
    expect(parseRedisConnection('redis://cache.internal')).toMatchObject({
      host: 'cache.internal',
      port: 6379,
    });
  });

  it('extracts credentials and db index', () => {
    const conn = parseRedisConnection('redis://user:p%40ss@10.0.0.1:6380/2');
    expect(conn).toMatchObject({
      host: '10.0.0.1',
      port: 6380,
      username: 'user',
      password: 'p@ss', // percent-decoded
      db: 2,
    });
  });

  it('leaves credentials undefined when absent', () => {
    const conn = parseRedisConnection('redis://localhost:6379');
    expect(conn).toMatchObject({ username: undefined, password: undefined, db: undefined });
  });
});
