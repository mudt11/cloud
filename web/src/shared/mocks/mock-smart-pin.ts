interface SmartPinRecord {
  salt: Uint8Array<ArrayBuffer>;
  verifier: Uint8Array<ArrayBuffer>;
}

const pinsByAccount = new Map<string, SmartPinRecord>();

export function isSmartPin(value: string) {
  return /^[0-9]{6}$/.test(value);
}

export function hasMockSmartPin(accountId: string) {
  return pinsByAccount.has(accountId);
}

async function deriveVerifier(pin: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function createMockSmartPin(accountId: string, pin: string) {
  if (!isSmartPin(pin) || hasMockSmartPin(accountId)) return false;

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveVerifier(pin, salt);
  if (hasMockSmartPin(accountId)) return false;

  pinsByAccount.set(accountId, { salt, verifier });
  return true;
}

export async function verifyMockSmartPin(accountId: string, pin: string) {
  const record = pinsByAccount.get(accountId);
  if (!record || !isSmartPin(pin)) return false;

  const candidate = await deriveVerifier(pin, record.salt);
  let different = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    different |= candidate[index] ^ record.verifier[index];
  }
  return different === 0;
}
