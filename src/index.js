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


async function hordeFetch(path, env, init = {}) {
  if (!env.AI_HORDE_API_KEY) throw new Error("The Worker is missing its AI_HORDE_API_KEY secret. Add it in Cloudflare Workers & Pages → studio-chat-api → Settings → Variables and Secrets.");
  return fetch("https://aihorde.net/api/v2" + path, {
    ...init,
    headers: {
      "apikey": env.AI_HORDE_API_KEY,
      "Client-Agent": "studio-chat:1.0:github.com/lamekmalik1-creator/Studio-Chat",
      ...(init.headers || {})
    }
  });
}

async function handleHordeModels(request, env) {
  const upstream = await fetch("https://aihorde.net/api/v2/status/models");
  if (!upstream.ok) return json(request, env, errorMessage("Could not load active AI Horde image models.", 502), 502);
  const payload = await upstream.json();
  const models = (Array.isArray(payload) ? payload : [])
    .filter((model) => model && model.name && Number(model.count || 0) > 0)
    .map((model) => ({ name: model.name, count: Number(model.count || 0), performance: Number(model.performance || 0) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return json(request, env, { models, configured: Boolean(env.AI_HORDE_API_KEY) });
}

async function handleHordeSubmit(request, env) {
  let body;
  try { body = await readJson(request); }
  catch (error) { return json(request, env, errorMessage(error.message), 400); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 950) return json(request, env, errorMessage("AI Horde prompts must be between 1 and 950 characters. Rebuild or shorten the prompt before generating."), 400);
  const model = typeof body.model === "string" ? body.model.trim() : "stable_diffusion";
  if (!model || model.length > 120) return json(request, env, errorMessage("Invalid image model."), 400);
  const width = Math.round(Number(body.width));
  const height = Math.round(Number(body.height));
  const allowedSizes = new Set(["768x1024", "768x1152", "1024x1024", "1024x768", "1152x648"]);
  if (!allowedSizes.has(width + "x" + height)) return json(request, env, errorMessage("Unsupported image dimensions."), 400);

  const upstream = await hordeFetch("/generate/async", env, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      params: { width, height, steps: 25, cfg_scale: 7.5, n: 1 },
      models: [model],
      nsfw: false,
      censor_nsfw: true,
      replacement_filter: true,
      trusted_workers: false,
      allow_downgrade: true,
      r2: true
    })
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || !payload.id) {
    const detail = String(payload.message || payload.error || ("HTTP " + upstream.status)).slice(0, 350);
    const ipTimeout = /ip.{0,40}timeout|timeout.{0,40}ip|abuse prevention/i.test(detail);
    const status = upstream.status === 429 || ipTimeout ? 429 : 502;
    const message = ipTimeout
      ? "AI Horde has temporarily placed the request IP in an abuse-prevention timeout. Stop retrying and wait before trying again; repeated blocked prompts can extend the timeout."
      : "AI Horde could not queue this image: " + detail;
    return json(request, env, errorMessage(message, status), status);
  }
  return json(request, env, { id: payload.id, kudos: payload.kudos || null, message: payload.message || "Request queued." }, 202);
}

async function handleHordeStatus(request, env, id) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return json(request, env, errorMessage("Invalid AI Horde request ID."), 400);
  const upstream = await hordeFetch("/generate/check/" + encodeURIComponent(id), env);
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return json(request, env, errorMessage(payload.message || "Could not check AI Horde generation status.", 502), 502);
  return json(request, env, {
    done: Boolean(payload.done),
    faulted: Boolean(payload.faulted),
    queue_position: Number.isFinite(payload.queue_position) ? payload.queue_position : null,
    wait_time: Number.isFinite(payload.wait_time) ? payload.wait_time : null,
    kudos: Number.isFinite(payload.kudos) ? payload.kudos : null
  });
}

async function handleHordeResult(request, env, id) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return json(request, env, errorMessage("Invalid AI Horde request ID."), 400);
  const upstream = await hordeFetch("/generate/status/" + encodeURIComponent(id), env);
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return json(request, env, errorMessage(payload.message || "Could not retrieve AI Horde result.", 502), 502);
  const imageUrl = payload.generations && payload.generations[0] && payload.generations[0].img;
  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
    return json(request, env, errorMessage("AI Horde has not returned a downloadable image yet.", 409), 409);
  }
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) return json(request, env, errorMessage("Could not download the generated image from AI Horde.", 502), 502);
  const headers = new Headers(corsHeaders(request, env));
  headers.set("Content-Type", imageResponse.headers.get("Content-Type") || "image/png");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(imageResponse.body, { status: 200, headers });
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
        return json(request, env, { ok: true, service: "studio-chat-api", provider: "openrouter", image_provider: "ai-horde" });
      }
      if (request.method === "GET" && url.pathname === "/api/models") return await handleModels(request, env);
      if (request.method === "POST" && url.pathname === "/api/chat") return await handleChat(request, env);
      if (request.method === "GET" && url.pathname === "/api/images/models") return await handleHordeModels(request, env);
      if (request.method === "POST" && url.pathname === "/api/images/submit") return await handleHordeSubmit(request, env);
      const hordeStatusMatch = url.pathname.match(/^\/api\/images\/status\/([^/]+)$/);
      if (request.method === "GET" && hordeStatusMatch) return await handleHordeStatus(request, env, hordeStatusMatch[1]);
      const hordeResultMatch = url.pathname.match(/^\/api\/images\/result\/([^/]+)$/);
      if (request.method === "GET" && hordeResultMatch) return await handleHordeResult(request, env, hordeResultMatch[1]);
      return json(request, env, errorMessage("Route not found.", 404), 404);
    } catch (error) {
      return json(request, env, errorMessage(error.message || "Unexpected Worker error.", 500), 500);
    }
  }
};