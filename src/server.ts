import "dotenv/config";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  console.info(`[server] Listening on http://localhost:${config.port}`);
});
