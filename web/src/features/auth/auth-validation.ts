import type { LoginInput, RegisterInput } from '../../shared/api/contracts';
import { normalizeDisplayName, normalizeEmail } from '../../shared/api/user-validation';

export function normalizeLogin({ email, password }: LoginInput): LoginInput {
  return { email: normalizeEmail(email), password };
}

export function normalizeRegistration({ email, password, displayName }: RegisterInput): RegisterInput {
  return { ...normalizeLogin({ email, password }), displayName: normalizeDisplayName(displayName) };
}
