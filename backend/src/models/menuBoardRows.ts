import type { RowDataPacket } from 'mysql2';
import type { MasterStatus } from '@menuboard/shared';

/** `menu_board_screens` (032) — one physical Digital Menu Board screen. */
export interface MenuBoardScreenRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  /** Blank means "whatever the POS prices against", i.e. the `pos.default_menu_code` setting. */
  menu_code: string;
  poll_seconds: number;
  /** JSON presentation blob — see `MenuBoardConfig`. */
  config: string | null;
  status: MasterStatus;
  last_seen_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  /** Present only on queries that join for display; never on the base select. */
  menu_name?: string | null;
}
