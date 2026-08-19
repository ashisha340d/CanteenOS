import {
  ClientType,
  type CreatePosOrderRequest,
  type KioskDeviceSummaryDto,
  type KioskProfileDto,
  type LoginResponse,
  type MenuTreeDto,
  type PosCheckoutRequest,
  type PosOrderDetailDto,
  type PrintPosBillResultDto,
  type SendPosBillWhatsAppResultDto,
} from '@menuboard/shared';
import { http, unwrap } from './client';
import { getDeviceId, saveRefreshToken, setAccessToken } from './session';

/**
 * Everything the kiosk is allowed to ask the server for. Every call below is reachable with
 * `MASTER_READ`, `POS_READ`, `POS_OPERATE` or `POS_CHECKOUT` and nothing wider — if this file
 * grows a request that needs more, the capability allowlist in `shared/src/permissions` is the
 * thing to check first, and widening it is a decision rather than a detail.
 */

export async function signIn(identifier: string, password: string): Promise<LoginResponse> {
  const session = await unwrap(
    http.post<{ success: true; data: LoginResponse }>('/auth/login', {
      identifier,
      password,
      deviceId: getDeviceId(),
      deviceName: 'Self-service kiosk',
      clientType: ClientType.KIOSK,
      rememberMe: true,
    }),
  );
  setAccessToken(session.tokens.accessToken);
  saveRefreshToken(session.tokens.refreshToken);
  return session;
}

/**
 * The stands this tablet could be. Names only — the registry's full rows, with their payees
 * and printer routing, are Admin Portal data and are not handed to a device in a public hall.
 */
export async function listKioskDevices(): Promise<KioskDeviceSummaryDto[]> {
  return unwrap(
    http.get<{ success: true; data: KioskDeviceSummaryDto[] }>('/pos/kiosk-devices'),
  );
}

export async function fetchMenuTree(menuCode: string): Promise<MenuTreeDto> {
  return unwrap(
    http.get<{ success: true; data: MenuTreeDto }>(
      `/menus/by-code/${encodeURIComponent(menuCode)}/tree`,
    ),
  );
}

/**
 * Raises the ticket. Only ids and quantities are sent: `PosService` resolves every price and
 * every paisa of tax server-side, which is what keeps a tablet in a public hall from being
 * able to sell a thali for one rupee.
 */
export async function createOrder(body: CreatePosOrderRequest): Promise<PosOrderDetailDto> {
  return unwrap(http.post<{ success: true; data: PosOrderDetailDto }>('/pos/orders', body));
}

export async function checkoutOrder(
  posOrderId: string,
  body: PosCheckoutRequest,
): Promise<PosOrderDetailDto> {
  return unwrap(
    http.post<{ success: true; data: PosOrderDetailDto }>(
      `/pos/orders/${posOrderId}/checkout`,
      body,
    ),
  );
}

/**
 * Everything the tablet is told: how the organisation wants its kiosks to look and speak, the
 * billing identity every receipt carries, and this stand's own row resolved from the code the
 * device holds. Read at start-up and re-read on a timer, so an operator's choice in the Admin
 * Portal — a new skin, a festival menu, a different payee — reaches the hall without anybody
 * walking over to reload a tablet.
 */
export async function fetchKioskProfile(deviceCode: string | null): Promise<KioskProfileDto> {
  return unwrap(
    http.get<{ success: true; data: KioskProfileDto }>('/pos/kiosk-profile', {
      params: deviceCode === null ? {} : { device: deviceCode },
    }),
  );
}

/** Asks the backend to print the bill on the networked counter printer. */
export async function printBillOnServer(
  posOrderId: string,
  copies = 1,
): Promise<PrintPosBillResultDto> {
  return unwrap(
    http.post<{ success: true; data: PrintPosBillResultDto }>(
      `/pos/orders/${posOrderId}/print`,
      { copies },
    ),
  );
}

/** Sends the settled bill to the guest's own WhatsApp. */
export async function sendBillOnWhatsApp(
  posOrderId: string,
  phone: string,
): Promise<SendPosBillWhatsAppResultDto> {
  return unwrap(
    http.post<{ success: true; data: SendPosBillWhatsAppResultDto }>(
      `/pos/orders/${posOrderId}/whatsapp`,
      { phone },
    ),
  );
}
