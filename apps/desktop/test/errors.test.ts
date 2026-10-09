import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UserFacingError } from '../src/main/account/account-service.ts';
import { friendlyError } from '../src/main/errors.ts';
import { ApiError, NetworkError } from '../src/main/http.ts';

describe('friendly errors', () => {
  it('explains connection, rate-limit, size, session and server problems in plain words', () => {
    expect(friendlyError(new NetworkError('ECONNREFUSED 127.0.0.1:8790'))).toMatch(
      /Can't reach your River server/,
    );
    expect(friendlyError(new ApiError(429, 'rate_limited', 'Rate limit exceeded'))).toMatch(/too fast/);
    expect(friendlyError(new ApiError(413, 'too_large', 'Body too large'))).toMatch(/too large/);
    expect(friendlyError(new ApiError(429, 'slowmode', 'Slowmode is on: you can send again in 12s.'))).toBe(
      'Slowmode is on: you can send again in 12s.',
    );
    expect(friendlyError(new ApiError(401, 'unauthorized', 'bad token'))).toMatch(/session ended/);
    expect(friendlyError(new ApiError(503, 'unavailable', 'db down'))).toMatch(/server had a problem/);
    expect(friendlyError(new ApiError(404, 'not_found', 'Not found'))).toBe('That no longer exists.');
  });

  it("passes on messages written for people, and hides everything else's details", () => {
    expect(friendlyError(new UserFacingError('Enter a server address.'))).toBe('Enter a server address.');
    expect(friendlyError(new ApiError(400, 'bad_request', 'Too many channels'))).toBe('Too many channels');
    expect(friendlyError(z.string().safeParse(1).error)).toBe('Please check what you entered.');
    expect(friendlyError(new Error('SQLITE_BUSY: database is locked at /secret/path'))).toBe(
      'Something went wrong. Check your connection and try again.',
    );
  });
});
