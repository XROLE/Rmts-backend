import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4000;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`Roommate NG API listening on http://localhost:${port}`);
});

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