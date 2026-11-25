export type UserRole = 'CUSTOMER' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface Account {
  id: string;
  userId: string;
  accountNumber: string;
  accountName: string;
  currency: 'VND';
  balance: string;
  status: 'ACTIVE' | 'FROZEN';
  createdAt: string;
  updatedAt: string;
}

export type RecipientLookup = Pick<Account, 'accountNumber' | 'accountName' | 'currency'>;

export interface TransferInput {
  fromAccountId: string;
  toAccountNumber: string;
  amount: string;
  description?: string;
}

export type TransferStatus = 'PENDING' | 'SUCCEEDED' | 'REJECTED';

export interface Transfer {
  id: string;
  requesterUserId: string;
  fromAccountId: string;
  toAccountId: string;
  fromAccountNumber: string;
  toAccountNumber: string;
  amount: string;
  currency: 'VND';
  description: string;
  status: TransferStatus;
  reasonCode: string | null;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  displayName: string;
}

export interface LoginData {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export interface ApiSuccess<T> {
  data: T;
  requestId: string;
}

export interface ApiErrorDetail {
  field: string;
  code: string;
  message: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: ApiErrorDetail[];
  };
  requestId: string;
}

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: `/api/v1/${string}`;
  headers: Headers;
  body?: unknown;
}
