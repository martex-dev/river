import { BackupError } from '@river/crypto';
import { z } from 'zod';
import { UserFacingError } from './account/account-service.ts';
import { CommunityError } from './community/community-service.ts';
import { ApiError, NetworkError } from './http.ts';

/**
 * Turns any error into one plain sentence for the person using River: what
 * happened and what to do. Internal details never reach the screen.
 */
export function friendlyError(err: unknown): string {
  if (err instanceof CommunityError || err instanceof UserFacingError || err instanceof BackupError)
    return err.message;
  if (err instanceof z.ZodError) return 'Please check what you entered.';
  if (err instanceof NetworkError)
    return "Can't reach your River server. Check your internet connection; River keeps trying.";
  if (err instanceof ApiError) {
    if (err.status === 429) return "You're doing that too fast. Wait a few seconds and try again.";
    if (err.status === 413) return "That's too large to send.";
    if (err.status === 401) return 'Your session ended. River is signing you in again; try once more.';
    if (err.status === 403) return 'You do not have permission to do that.';
    if (err.status === 404) return 'That no longer exists.';
    if (err.status >= 500) return 'Your River server had a problem. Try again in a moment.';
    if (err.message && err.message !== 'Bad request') return err.message;
  }
  return 'Something went wrong. Check your connection and try again.';
}
