import { FolderResolver, Generator } from '@foundry/generator';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();

// Wire the folder backend → generator → HTTP API. Swapping storage (git-ref,
// package registry) is a one-line change here; nothing downstream moves.
const resolver = new FolderResolver(config.blueprintsDir);
const generator = new Generator(resolver);

const app = createApp({
  resolver,
  generator,
  authDisabled: config.authDisabled,
  corsOrigin: config.corsOrigin,
});

app.listen(config.port, () => {
  console.log(
    `[foundry] API listening on http://localhost:${config.port}  ` +
      `(auth ${config.authDisabled ? 'DISABLED' : 'enabled'}, ` +
      `blueprints: ${config.blueprintsDir}, cors: ${config.corsOrigin})`,
  );
});
