import 'dotenv/config';
import { createApp } from './app.js';
import { whatsappLifecycleService } from './services/whatsappLifecycle.service.js';

const port = Number(process.env.PORT) || 4000;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`Roommate NG API listening on http://localhost:${port}`);
});

// Sweep for time-bound match fee links (nudge/expire unpaid links). Runs once
// on boot then on MATCH_PAYMENT_SCHEDULER_INTERVAL_MIN (default 15). Set to 0
// to disable the in-process scheduler.
const schedulerIntervalMin = Number(process.env.MATCH_PAYMENT_SCHEDULER_INTERVAL_MIN ?? 15);
if (schedulerIntervalMin > 0) {
  const runSweep = () => {
    whatsappLifecycleService
      .processDueMatchPayments()
      .then((result) => console.log('[scheduler] match payment sweep:', result))
      .catch((err) => console.error('[scheduler] match payment sweep failed:', err));
  };
  runSweep();
  setInterval(runSweep, schedulerIntervalMin * 60 * 1000);
}

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is already in use. Stop the other instance or set a different PORT.`,
    );
  } else {
    console.error('Failed to start server:', err);
  }
  process.exit(1);
});