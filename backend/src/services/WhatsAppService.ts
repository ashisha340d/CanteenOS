import {
  PosOrderStatus,
  toReceiptText,
  type EscPosBill,
  type SendPosBillWhatsAppResultDto,
} from '@menuboard/shared';
import { config } from '../config';
import { getPool } from '../db/pool';
import { AppError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { posService } from './PosService';
import { receiptService } from './ReceiptService';
import { settingsService } from './SettingsService';

/**
 * Sending a settled GST bill to the guest's own WhatsApp.
 *
 * Meta refuses free-form text for a conversation a business starts, so this sends an approved
 * *template* and fills its placeholders. That constraint shapes the whole design: the bill
 * arrives as six parameters rather than as a document, because a document message needs a URL
 * Meta's servers can reach and a temple hall's backend is not on the public internet.
 *
 * Credentials absent is a supported state, not a broken one. `isConfigured()` is what the
 * kiosk profile reports, so a deployment without WhatsApp simply never offers a guest the
 * choice — rather than offering it and failing at the last step of a queue.
 */

/** Body placeholders `{{1}}`..`{{6}}`, in the order the approved template must declare them. */
const TEMPLATE_PARAMETER_COUNT = 6;

/** Meta rejects a body parameter carrying a newline, a tab, or four consecutive spaces. */
function asTemplateParameter(value: string, limit = 700): string {
  const flattened = toReceiptText(value).replace(/\s+/g, ' ').trim();
  return flattened.length > limit ? `${flattened.slice(0, limit - 1)}…` : flattened;
}

export class WhatsAppService {
  isConfigured(): boolean {
    return (
      config.whatsapp.phoneNumberId.trim() !== '' && config.whatsapp.accessToken.trim() !== ''
    );
  }

  /** True only when the organisation has both switched it on and given the backend credentials. */
  async billDeliveryAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    return settingsService.get<boolean>('kiosk.whatsapp_bill_enabled');
  }

  async sendBill(
    posOrderId: string,
    phoneInput: string | null,
    actor: AuditActor,
  ): Promise<SendPosBillWhatsAppResultDto> {
    if (!(await this.billDeliveryAvailable())) {
      throw new ValidationError('Sending bills over WhatsApp is not available', [
        {
          path: 'whatsapp',
          message: this.isConfigured()
            ? 'Turn on “Bill on WhatsApp” in Settings'
            : 'The backend holds no WhatsApp credentials',
        },
      ]);
    }

    const order = await posService.getDetail(posOrderId);
    if (order.status !== PosOrderStatus.COMPLETED) {
      throw new ValidationError('Only a settled sale has a bill to send', [
        { path: 'status', message: `The ticket is ${order.status}, not COMPLETED` },
      ]);
    }

    // The number the guest gave at the kiosk is already on the ticket; an explicit one is for
    // the counter re-sending a bill somebody asked for after they had walked away.
    const phone = normalisePhone(phoneInput ?? order.entityPhone ?? '');

    const bill = await receiptService.buildBill(order);
    const messageId = await this.sendTemplate(phone, templateParameters(bill));

    await auditService.record(getPool(), actor, {
      action: AuditAction.POS_BILL_WHATSAPP_SENT,
      entityType: 'pos_order',
      entityId: order.id,
      // The number is the point of the record: it is where a tax document went.
      after: { phone, messageId, orderNumber: order.orderNumber },
    });

    return { phone, messageId, sentAt: new Date().toISOString() };
  }

  private async sendTemplate(to: string, parameters: string[]): Promise<string> {
    const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(config.whatsapp.requestTimeoutMs),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: config.whatsapp.templateName,
            language: { code: config.whatsapp.templateLanguage },
            components: [
              {
                type: 'body',
                parameters: parameters.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
      });
    } catch (error) {
      logger.warn('WhatsApp Cloud API request failed', {}, error);
      throw new AppError(502, 'INTERNAL_ERROR', 'WhatsApp could not be reached', {
        cause: error,
      });
    }

    const body = (await response.json().catch(() => null)) as WhatsAppResponse | null;
    const providerError = body?.error;

    if (!response.ok || body === null || providerError !== undefined) {
      const detail = providerError?.message ?? `HTTP ${response.status}`;
      logger.warn('WhatsApp Cloud API rejected the message', { status: response.status, detail });
      // The provider's own wording is the useful one — a wrong template name and a blocked
      // number fail identically otherwise, and only one of them is fixable at the counter.
      throw new ValidationError('WhatsApp refused the message', [
        { path: 'whatsapp', message: detail },
      ]);
    }

    const messageId = body.messages?.[0]?.id;
    if (messageId === undefined) {
      throw new AppError(502, 'INTERNAL_ERROR', 'WhatsApp accepted the message without an id');
    }
    return messageId;
  }
}

interface WhatsAppResponse {
  messages?: { id: string }[];
  error?: { message: string; code?: number };
}

/**
 * The six template parameters, in order:
 * outlet, bill number, date, items, tax summary, total.
 */
function templateParameters(bill: EscPosBill): string[] {
  const items = bill.lines
    .map((line) => `${line.name}${line.variantName ? ` (${line.variantName})` : ''} x${line.quantity}`)
    .join(', ');

  const taxed = bill.taxBuckets.filter((bucket) => bucket.rate > 0);
  const taxSummary =
    taxed.length === 0
      ? 'No GST charged on this bill'
      : taxed
          .map(
            (bucket) =>
              `GST ${bucket.rate}% on Rs.${bucket.taxable.toFixed(2)} = Rs.${(
                bucket.cgst +
                bucket.sgst +
                bucket.igst +
                bucket.cess
              ).toFixed(2)}`,
          )
          .join('; ');

  const parameters = [
    bill.outletName,
    bill.billNumber,
    bill.billedAt,
    items,
    taxSummary,
    bill.total.toFixed(2),
  ].map((value) => asTemplateParameter(value));

  if (parameters.length !== TEMPLATE_PARAMETER_COUNT) {
    throw new AppError(500, 'INTERNAL_ERROR', 'WhatsApp bill template parameters are malformed');
  }
  return parameters;
}

/**
 * To E.164 without the leading `+`, which is the form the Cloud API wants.
 *
 * A guest at a kiosk types ten digits and nothing else, so a bare national number is the
 * normal case and the configured country code is prefixed. Everything else — a leading zero,
 * spaces, a `+`, a country code already present — is accepted and normalised rather than
 * refused, because the alternative is a queue held up by a phone-number format lecture.
 */
export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits === '') {
    throw new ValidationError('A phone number is needed to send the bill', [
      { path: 'phone', message: 'Enter the number the bill should go to' },
    ]);
  }

  const country = config.whatsapp.defaultCountryCode.replace(/\D/g, '');
  const national = digits.startsWith('0') ? digits.replace(/^0+/, '') : digits;

  const e164 = national.length === 10 ? `${country}${national}` : national;

  if (e164.length < 11 || e164.length > 15) {
    throw new ValidationError('That does not look like a phone number', [
      { path: 'phone', message: 'Enter a ten-digit mobile number' },
    ]);
  }
  return e164;
}

export const whatsAppService = new WhatsAppService();
