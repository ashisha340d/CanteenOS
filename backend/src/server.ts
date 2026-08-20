import http from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { closePool, verifyConnection } from './db/pool';
import { migrationStatus } from './db/migrator';
import { createSocketServer } from './realtime/socketServer';
import { realtime } from './realtime/RealtimeGateway';
import { menuBoardRealtime } from './realtime/menuBoardSocket';
import { attachmentService } from './services/AttachmentService';
import { maintenanceSchedulerService } from './services/MaintenanceSchedulerService';
import { cleaningSchedulerService } from './services/CleaningSchedulerService';
import { menuShiftSchedulerService } from './services/MenuShiftSchedulerService';
import { permissionsCacheService } from './services/PermissionsCacheService';
import { youtubeImportService } from './services/YoutubeImportService';
import { refreshTokenRepository } from './repositories/RefreshTokenRepository';
import { getPool } from './db/pool';
import { logger } from './utils/logger';
import { ensureMediaDirectories } from './utils/mediaStorage';
import { printStartupBanner } from './utils/startupBanner';

/** Housekeeping cadence. Both jobs are cheap and idempotent, so a missed run is harmless. */
const HOUSEKEEPING_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function main(): Promise<void> {
  await verifyConnection();
  logger.debug('Database connection verified');

  // A server running against an out-of-date schema fails in confusing ways later; better to
  // refuse to start.
  const pending = (await migrationStatus()).filter((record) => record.status !== 'APPLIED');
  if (pending.length > 0) {
    throw new Error(
      `Database schema is not up to date. Run "npm run migrate". Outstanding: ${pending
        .map((record) => `${record.name} (${record.status})`)
        .join(', ')}`,
    );
  }

  await ensureMediaDirectories();
  await permissionsCacheService.load();

  // The YouTube Recipe Downloader's in-process worker: the queue is its DB table, so this
  // just re-queues anything a previous process left mid-flight and starts the drain loop.
  await youtubeImportService.startWorker();

  // Preventive maintenance: turns schedules that have fallen due into tickets and raises the
  // due/overdue/warranty reminders. Idempotent, so a missed run costs nothing.
  maintenanceSchedulerService.start();

  // The cleaning sweep: raises the calendar occurrences that have come due and chases the
  // overdue and unowned ones. Hourly rather than six-hourly, because a cleaning rule can name
  // a due time and a late sweep would raise it already overdue.
  cleaningSchedulerService.start();

  // Un-hides whatever the morning/evening shift boundary brings back onto a menu. Also
  // idempotent — see MenuShiftSchedulerService's `menu.last_shift_reset` bookkeeping.
  menuShiftSchedulerService.start();

  const app = createApp();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);

  const housekeeping = setInterval(() => {
    void runHousekeeping();
  }, HOUSEKEEPING_INTERVAL_MS);
  // Never let the timer hold the process open during shutdown.
  housekeeping.unref();

  await listenWithRetry(httpServer, config.port);

  registerShutdownHandlers(httpServer, housekeeping);
}

/**
 * On a tsx-watch restart (and on Windows generally) the previous process can still hold the
 * port for a moment after the new one boots, so a first EADDRINUSE is retried briefly instead
 * of crashing the watcher into a dead state.
 */
async function listenWithRetry(httpServer: http.Server, port: number, attempts = 15): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException): void => {
          httpServer.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          httpServer.removeListener('error', onError);
          resolve();
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port);
      });
      logger.debug('MenuBoard backend listening', {
        port,
        env: config.env,
        publicUrl: config.publicUrl,
      });
      printStartupBanner();
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || attempt >= attempts) throw error;
      logger.warn('Port busy, retrying', { port, attempt });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function runHousekeeping(): Promise<void> {
  try {
    const swept = await attachmentService.sweepOrphans();
    const purged = await refreshTokenRepository.purgeExpired(
      getPool(),
      new Date(Date.now() - 30 * 86_400_000),
    );
    logger.info('Housekeeping complete', { orphansSwept: swept, tokensPurged: purged });
  } catch (error) {
    logger.error('Housekeeping failed', undefined, error);
  }
}

function registerShutdownHandlers(
  httpServer: http.Server,
  housekeeping: NodeJS.Timeout,
): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    // A second Ctrl-C must not start a parallel teardown.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('Shutting down', { signal });
    clearInterval(housekeeping);
    youtubeImportService.stopWorker();
    maintenanceSchedulerService.stop();
    cleaningSchedulerService.stop();
    menuShiftSchedulerService.stop();
    realtime.detach();
    menuBoardRealtime.detach();

    // Stop accepting new work, let in-flight requests finish, then release the pool.
    const closed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([closed, timeout]);

    await closePool();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', undefined, reason);
  });

  process.on('uncaughtException', (error) => {
    // The process state is no longer trustworthy after an uncaught exception; log and exit so a
    // supervisor restarts cleanly rather than serving from a corrupt state.
    logger.error('Uncaught exception; exiting', undefined, error);
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  logger.error('Failed to start MenuBoard backend', undefined, error);
  process.exit(1);
});
