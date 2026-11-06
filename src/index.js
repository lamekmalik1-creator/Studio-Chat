const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 12000;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "https://lamekmalik1-creator.github.io")
    .split(",").map((value) => value.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = allowedOrigins(env);
  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) }
  });
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins(env).includes(origin);
}

function errorMessage(message, status = 400) {
  return { error: message, status };
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  try { return JSON.parse(raw); } catch { throw new Error("Request body must be valid JSON."); }
}

async function openRouterFetch(path, env, init = {}) {
  if (!env.OPENROUTER_API_KEY) throw new Error("The Worker is missing its OPENROUTER_API_KEY secret.");
  return fetch("https://openrouter.ai/api/v1" + path, {
    ...init,
    headers: {
      "Authorization": "Bearer " + env.OPENROUTER_API_KEY,
      "HTTP-Referer": env.APP_URL || "https://lamekmalik1-creator.github.io/Studio-Chat/",
      "X-Title": "Studio Chat",
      ...(init.headers || {})
    }
  });
}

async function handleModels(request, env) {
  const upstream = await openRouterFetch("/models", env);
  if (!upstream.ok) return json(request, env, errorMessage("Could not load models from OpenRouter.", 502), 502);
  const payload = await upstream.json();
  const models = (payload.data || [])
    .filter((model) => model.id === "openrouter/free" || model.id.endsWith(":free"))
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      context_length: model.context_length || null
    }))
    .sort((a, b) => a.id === "openrouter/free" ? -1 : b.id === "openrouter/free" ? 1 : a.name.localeCompare(b.name));
  return json(request, env, { models, default_model: "openrouter/free" });
}

async function handleChat(request, env) {
  let body;
  try { body = await readJson(request); }
  catch (error) { return json(request, env, errorMessage(error.message), 400); }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    return json(request, env, errorMessage("Provide between 1 and " + MAX_MESSAGES + " chat messages."), 400);
  }
  for (const item of messages) {
    if (!item || !["system", "user", "assistant"].includes(item.role) ||
        typeof item.content !== "string" || item.content.length > MAX_MESSAGE_CHARS) {
      return json(request, env, errorMessage("A message has an invalid role or content."), 400);
    }
  }

  const requestedModel = typeof body.model === "string" ? body.model : "openrouter/free";
  if (requestedModel.length > 180 || !(requestedModel === "openrouter/free" || requestedModel.endsWith(":free"))) {
    return json(request, env, errorMessage("Only OpenRouter free models are enabled in this build."), 400);
  }

  const upstream = await openRouterFetch("/chat/completions", env, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: requestedModel,
      messages,
      stream: true,
      temperature: Number.isFinite(body.temperature) ? Math.min(1.5, Math.max(0, body.temperature)) : 0.85,
      max_tokens: Number.isFinite(body.max_tokens) ? Math.min(900, Math.max(80, body.max_tokens)) : 420
    })
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return json(request, env, errorMessage("OpenRouter request failed (" + upstream.status + "): " + detail.slice(0, 700), 502), 502);
  }

  const headers = new Headers(corsHeaders(request, env));
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("X-Accel-Buffering", "no");
  return new Response(upstream.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    if (!originAllowed(request, env)) {
      return json(request, env, errorMessage("This website origin is not allowed.", 403), 403);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(request, env, { ok: true, service: "studio-chat-api", provider: "openrouter" });
      }
      if (request.method === "GET" && url.pathname === "/api/models") return await handleModels(request, env);
      if (request.method === "POST" && url.pathname === "/api/chat") return await handleChat(request, env);
      return json(request, env, errorMessage("Route not found.", 404), 404);
    } catch (error) {
      return json(request, env, errorMessage(error.message || "Unexpected Worker error.", 500), 500);
    }
  }
};