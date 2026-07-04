import { deployReadySchema, parseBearer } from './deploy-ready.dto';

describe('parseBearer', () => {
  it('extracts the token from a Bearer header', () => {
    expect(parseBearer('Bearer abc123')).toBe('abc123');
  });

  it('returns empty for missing or non-bearer headers', () => {
    expect(parseBearer(undefined)).toBe('');
    expect(parseBearer('Basic xyz')).toBe('');
    expect(parseBearer('')).toBe('');
  });
});

describe('deployReadySchema', () => {
  it('accepts a deploy_id', () => {
    expect(deployReadySchema.safeParse({ deploy_id: 'd-1' }).success).toBe(true);
  });

  it('rejects an empty deploy_id', () => {
    expect(deployReadySchema.safeParse({ deploy_id: '' }).success).toBe(false);
    expect(deployReadySchema.safeParse({}).success).toBe(false);
  });
});
