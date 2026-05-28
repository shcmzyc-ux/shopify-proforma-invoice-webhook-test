import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";

let appPromise: Promise<Express> | undefined;

async function getApp(): Promise<Express> {
  appPromise ??= import("../src/app.js").then(({ createApp }) => createApp());
  return appPromise;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    const app = await getApp();
    return app(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[vercel] Function initialization failed: ${message}`);

    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
      ok: false,
      error: "Function initialization failed",
      message
      })
    );
  }
}
