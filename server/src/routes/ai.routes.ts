import { Hono } from "hono";
import { getOllamaStatus, listOllamaModels } from "../services/ai.service";

const aiRoutes = new Hono();

aiRoutes.get("/status", async (c) => {
  const status = await getOllamaStatus();
  return c.json(status);
});

aiRoutes.get("/models", async (c) => {
  try {
    const models = await listOllamaModels();
    return c.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch models";
    return c.json({ error: message }, 503);
  }
});

export default aiRoutes;
