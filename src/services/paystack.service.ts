import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/errorHandler.js';

const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co';

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new HttpError(500, 'PAYSTACK_SECRET_KEY is not configured');
  }
  return key;
}

interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = secretKey();
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const body = (await res.json().catch(() => ({}))) as PaystackResponse<T>;

  if (!res.ok || body.status === false) {
    throw new HttpError(502, `Paystack error: ${body.message ?? `HTTP ${res.status}`}`);
  }

  return body.data;
}

export interface InitializePaymentInput {
  amountKobo: number;
  email: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  callbackUrl?: string;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface TransferRecipientResult {
  recipientCode: string;
}

export interface TransferResult {
  transferCode: string;
  reference: string;
}

export class PaystackService {
  /**
   * Creates a one-time payment session. Amount is expected in kobo.
   */
  async initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const reference = input.reference ?? randomUUID();
    const data = await request<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: input.amountKobo,
        reference,
        metadata: input.metadata,
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      }),
    });

    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      reference: data.reference,
    };
  }

  /**
   * Verifies a transaction by reference. Returns the transaction status
   * ("success", "pending", "failed", "abandoned", etc.) and amount (kobo).
   */
  async verifyTransaction(reference: string) {
    const data = await request<{
      status: string;
      reference: string;
      amount: number;
      currency: string;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);

    return {
      status: data.status,
      reference: data.reference,
      amountKobo: data.amount,
      currency: data.currency,
    };
  }

  /**
   * Creates a transfer recipient for an ambassador's bank account.
   */
  async createTransferRecipient(input: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<TransferRecipientResult> {
    const data = await request<{ recipient_code: string }>('/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({
        type: 'nuban',
        name: input.name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: 'NGN',
      }),
    });

    return { recipientCode: data.recipient_code };
  }

  /**
   * Initiates a transfer to an existing recipient. Amount is expected in kobo.
   */
  async initiateTransfer(input: {
    amountKobo: number;
    recipientCode: string;
    reference?: string;
  }): Promise<TransferResult> {
    const reference = input.reference ?? randomUUID();
    const data = await request<{
      transfer_code: string;
      reference: string;
    }>('/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: input.amountKobo,
        recipient: input.recipientCode,
        reference,
      }),
    });

    return { transferCode: data.transfer_code, reference: data.reference };
  }

  /**
   * Verifies a Paystack webhook by computing the HMAC-SHA512 signature over
   * the raw body and comparing it with the x-paystack-signature header.
   */
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const hash = createHmac('sha512', secretKey())
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}

export const paystackService = new PaystackService();
