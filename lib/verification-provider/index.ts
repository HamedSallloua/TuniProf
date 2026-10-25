import { getVerificationProviderName } from '@/lib/env';
import { devStubProvider } from './dev-stub';
import type { VerificationProvider } from './types';
import { whatsappProvider } from './whatsapp';

export function getVerificationProvider(): VerificationProvider {
  return getVerificationProviderName() === 'whatsapp'
    ? whatsappProvider
    : devStubProvider;
}

export type { VerificationProvider } from './types';
