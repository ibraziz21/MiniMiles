import { describe, expect, it } from 'vitest';

import { ApiRequestError, readApiErrorEnvelope } from '@/api/errors';

describe('API error messages', () => {
  it('shows the insufficient-Miles explanation when opening a paid voucher fails', () => {
    const body = { error: { code: 'INSUFFICIENT_MILES', message: 'Not enough Miles', retryable: false } };
    const error = new ApiRequestError('Akiba API request failed with 422', 422, body);

    expect(error.message).toBe('Not enough Miles');
    expect(error.status).toBe(422);
    expect(error.body).toBe(body);
    expect(readApiErrorEnvelope(error)?.code).toBe('INSUFFICIENT_MILES');
  });

  it.each([null, {}, { error: null }, { error: 'unavailable' }, { error: { message: 422 } }, { error: { message: '  ' } }])(
    'retains a useful fallback for malformed error responses: %j',
    body => {
      expect(new ApiRequestError('Could not verify voucher', 503, body).message).toBe('Could not verify voucher');
    },
  );
});
