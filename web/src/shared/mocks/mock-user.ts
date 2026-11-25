import type { LoginData, User, UserRole } from '../api/contracts';

interface UserRecord {
  user: User;
  password: string;
}

interface MockSession {
  userId: string;
  nameAtSignIn: string;
  role: UserRole;
  expiresAt: number;
}

const demoPassword = 'DemoPass2026!';
const demoCreatedAt = '2026-11-02T03:00:00.000Z';

export const transferDemoUsers = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'chuyen-tien@example.test',
    displayName: 'Nguyễn Văn Minh',
    role: 'CUSTOMER',
    createdAt: demoCreatedAt,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'nhan-tien@example.test',
    displayName: 'Trần Thu Hà',
    role: 'CUSTOMER',
    createdAt: demoCreatedAt,
  },
] as const satisfies readonly User[];

export const demoAccounts = [
  { role: 'CUSTOMER', label: 'Khách hàng', email: 'a@example.test', password: demoPassword },
  { role: 'ADMIN', label: 'Quản trị viên', email: 'admin@example.test', password: demoPassword },
  { role: 'CUSTOMER', label: 'Khách hàng có số dư mẫu', email: transferDemoUsers[0].email, password: demoPassword },
  { role: 'CUSTOMER', label: 'Người nhận mẫu', email: transferDemoUsers[1].email, password: demoPassword },
] as const;

const initialUsers: User[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: demoAccounts[0].email,
    displayName: 'Nguyễn Văn A',
    role: 'CUSTOMER',
    createdAt: demoCreatedAt,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: demoAccounts[1].email,
    displayName: 'Quản trị viên',
    role: 'ADMIN',
    createdAt: demoCreatedAt,
  },
  ...transferDemoUsers,
];

const usersByEmail = new Map<string, UserRecord>();
const usersById = new Map<string, UserRecord>();
const sessions = new Map<string, MockSession>();

function rememberUser(record: UserRecord) {
  usersByEmail.set(record.user.email, record);
  usersById.set(record.user.id, record);
}

initialUsers.forEach((user) => rememberUser({ user, password: demoPassword }));

export function registerMockUser(email: string, password: string, displayName: string): User | undefined {
  if (usersByEmail.has(email)) return undefined;

  const user: User = {
    id: crypto.randomUUID(),
    email,
    displayName,
    role: 'CUSTOMER',
    createdAt: new Date().toISOString(),
  };
  rememberUser({ user, password });
  return user;
}

export function signInMockUser(email: string, password: string): LoginData | undefined {
  const record = usersByEmail.get(email);
  if (!record || record.password !== password) return undefined;

  const accessToken = crypto.randomUUID();
  const expiresIn = 900;
  sessions.set(accessToken, {
    userId: record.user.id,
    nameAtSignIn: record.user.displayName,
    role: record.user.role,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return { accessToken, tokenType: 'Bearer', expiresIn, user: record.user };
}

export function getMockSession(authorization: string | null): MockSession | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;

  const session = sessions.get(authorization.slice(7));
  return session && session.expiresAt > Date.now() ? session : undefined;
}

export function getMockUser(userId: string) {
  return usersById.get(userId)?.user;
}

export function updateMockDisplayName(userId: string, displayName: string): User | undefined {
  const record = usersById.get(userId);
  if (!record) return undefined;

  record.user = { ...record.user, displayName };
  return record.user;
}
