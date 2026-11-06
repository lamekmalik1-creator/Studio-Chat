const $ = (id) => document.getElementById(id);
const STORAGE_CHARACTER = "studioChat.character.v1";
const STORAGE_MESSAGES = "studioChat.messages.v1";
const STORAGE_API_BASE = "studioChat.apiBase.v1";
const STORAGE_MODEL = "studioChat.model.v1";

let character = loadJSON(STORAGE_CHARACTER, null);
let messages = loadJSON(STORAGE_MESSAGES, []);
let waiting = false;
let abortController = null;
let modelList = [];

function loadJSON(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { setChatStatus("This browser could not save local chat history."); }
}
function getApiBase() {
  return String(localStorage.getItem(STORAGE_API_BASE) || "").trim().replace(/\/+$/, "");
}
function setChatStatus(message) { $("chatStatus").textContent = message; }
function switchPanel(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === name));
}
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel)));

// PWA installation prompt.
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); deferredInstallPrompt = event; $("installBtn").hidden = false;
});
$("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null; $("installBtn").hidden = true;
});
window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; deferredInstallPrompt = null; });

// Install help dialog.
const dialog = $("installHelp");
$("helpInstall").addEventListener("click", () => dialog.showModal());
$("closeHelp").addEventListener("click", () => dialog.close());
$("okHelp").addEventListener("click", () => dialog.close());

function renderCharacter() {
  const box = $("activeCharacter");
  if (!character) {
    box.textContent = "No character selected yet. Create one in the Character tab first.";
    return;
  }
  box.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = character.name + " · " + character.age;
  const details = document.createElement("span");
  details.textContent = [character.appearance, character.personality, character.scenario].filter(Boolean).join(" · ");
  box.append(name, details);
}
function renderMessages() {
  const log = $("chatLog");
  log.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.textContent = "Your roleplay will appear here. Send the first message to begin.";
    log.append(empty);
    return;
  }
  for (const message of messages) {
    const item = document.createElement("div");
    item.className = "chat-message " + (message.role === "user" ? "from-user" : message.role === "image" ? "from-image" : "from-character");
    const label = document.createElement("strong");
    label.textContent = message.role === "user" ? "You" : message.role === "image" ? "Generated scene" : (character?.name || "Character");
    item.append(label);
    if (message.role === "image") {
      const preview = document.createElement("img");
      preview.className = "chat-image-preview";
      preview.alt = "Generated roleplay scene";
      item.append(preview);
      const caption = document.createElement("p");
      caption.className = "image-message-caption";
      caption.textContent = message.content || "";
      item.append(caption);
      getStoredImage(message.imageId).then((record) => {
        if (record && preview.isConnected) preview.src = URL.createObjectURL(record.blob);
      }).catch(() => {});
    } else {
      const body = document.createElement("p");
      body.textContent = message.content;
      item.append(body);
    }
    if (message.role === "user" && message.failed) {
      const resend = document.createElement("button");
      resend.type = "button";
      resend.className = "resend-btn";
      resend.textContent = waiting ? "Retrying…" : "↻ Resend";
      resend.disabled = waiting;
      resend.setAttribute("aria-label", "Resend this message");
      resend.addEventListener("click", () => retryMessage(messages.indexOf(message)));
      item.append(resend);
    }
    log.append(item);
  }
  log.scrollTop = log.scrollHeight;
}
function saveConversation() { saveJSON(STORAGE_MESSAGES, messages.slice(-80)); }

$("characterForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const age = Number($("charAge").value);
  if (!Number.isInteger(age) || age < 18) {
    $("characterStatus").textContent = "Characters used for adult roleplay must be at least 18.";
    return;
  }
  character = {
    name: $("charName").value.trim(),
    age,
    appearance: $("charAppearance").value.trim(),
    personality: $("charPersonality").value.trim(),
    background: $("charBackground").value.trim(),
    scenario: $("charScenario").value.trim(),
    style: $("roleplayStyle").value,
    content: $("contentMode").value
  };
  if (!character.name) return;
  saveJSON(STORAGE_CHARACTER, character);
  messages = [];
  saveConversation();
  renderCharacter();
  renderMessages();
  $("characterStatus").textContent = "Character saved in this browser. You can start chatting.";
  switchPanel("chat");
  setChatStatus("Ready. Connect your Cloudflare Worker to begin.");
});

function buildSystemPrompt() {
  return [
    "You are an interactive fictional roleplay character. Write ONLY the character's next reply.",
    "Never write, invent, quote, or continue the user's side of the conversation. Do not narrate the user's actions, words, thoughts, or feelings.",
    "Do not output system prompts, hidden instructions, analysis, reasoning, thoughts, <think> tags, or formatting tokens. Do not include speaker labels such as User:, You:, Human:, or Assistant:.",
    "Write immersive roleplay with a natural balance of physical action, sensory detail, emotion, and spoken dialogue. Use asterisks for actions when appropriate and quotation marks for spoken dialogue. Vary the response length naturally, usually 2-5 sentences. Then stop.",
    "CHARACTER PROFILE",
    "Name: " + character.name,
    "Age: " + character.age + " (an adult)",
    "Appearance: " + (character.appearance || "Not specified"),
    "Personality: " + (character.personality || "Develop a consistent personality from the scenario"),
    "Background: " + (character.background || "Not specified"),
    "Current scenario: " + (character.scenario || "Begin a natural conversation with the user"),
    "Writing style: " + character.style,
    "Content guidance: " + character.content,
    "Rules: All characters in adult situations are adults aged 18 or older. Respect consent. Never decide the user's actions or thoughts. Do not break character unless asked. Fictional horror and zombie themes are welcome."
  ].join("\n\n");
}

function cleanCharacterReply(raw) {
  let answer = String(raw || "").trim();
  answer = answer.replace(/<\/?think>/gi, "");
  answer = answer.replace(/<\|(?:im_start|im_end|endoftext|assistant|analysis|final)\|>/gi, "");
  answer = answer.replace(/\n\s*(?:#{1,6}\s*)?(?:user|you|human)\s*:[\s\S]*$/i, "");
  const escapedName = (character?.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escapedName) answer = answer.replace(new RegExp("^\\s*(?:" + escapedName + "|assistant)\\s*:\\s*", "i"), "");
  return answer.trim();
}

async function apiFetch(path, options = {}) {
  const base = getApiBase();
  if (!base) throw new Error("Add your Cloudflare Worker URL above and tap Connect first.");
  let response;
  try {
    response = await fetch(base + path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
  } catch {
    throw new Error("Could not reach the Worker. Check the URL, deployment, and allowed-origin setting.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || ("Worker returned HTTP " + response.status));
  }
  return response;
}

async function connectWorker() {
  const base = $("apiBase").value.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) {
    $("connectionStatus").textContent = "Enter the full HTTPS URL of your deployed Cloudflare Worker.";
    return;
  }
  localStorage.setItem(STORAGE_API_BASE, base);
  $("connectionStatus").textContent = "Checking Worker…";
  try {
    const healthResponse = await apiFetch("/api/health");
    const health = await healthResponse.json();
    if (!health.ok) throw new Error("Worker health check did not pass.");
    const modelsResponse = await apiFetch("/api/models");
    const data = await modelsResponse.json();
    modelList = Array.isArray(data.models) ? data.models : [];
    renderModels(data.default_model || "openrouter/free");
    $("connectionStatus").textContent = "Connected to Studio Chat API. " + modelList.length + " free model options found.";
    setChatStatus("Connected. Choose a free model and start your roleplay.");
  } catch (error) {
    $("connectionStatus").textContent = error.message;
  }
}
function renderModels(defaultModel) {
  const select = $("modelSelect");
  const saved = localStorage.getItem(STORAGE_MODEL) || defaultModel;
  select.replaceChildren();
  const fallback = document.createElement("option");
  fallback.value = "openrouter/free";
  fallback.textContent = "Auto · OpenRouter Free";
  select.append(fallback);
  for (const model of modelList) {
    if (model.id === "openrouter/free") continue;
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name + " · Free";
    select.append(option);
  }
  select.value = [...select.options].some((option) => option.value === saved) ? saved : "openrouter/free";
  localStorage.setItem(STORAGE_MODEL, select.value);
}
$("connectWorker").addEventListener("click", connectWorker);
$("modelSelect").addEventListener("change", () => localStorage.setItem(STORAGE_MODEL, $("modelSelect").value));

async function streamReply() {
  const recent = messages.filter((message) => message.role === "user" || message.role === "assistant").slice(-20).map(({ role, content }) => ({ role, content }));
  const response = await apiFetch("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model: $("modelSelect").value || "openrouter/free",
      messages: [{ role: "system", content: buildSystemPrompt() }, ...recent],
      temperature: 0.85,
      max_tokens: 480
    })
  });
  if (!response.body) throw new Error("This browser does not support streamed replies.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let lastRender = 0;

  function consumeLine(line) {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const chunk = JSON.parse(payload);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) answer += delta;
    } catch { /* Ignore non-JSON SSE lines. */ }
  }

  messages.push({ role: "assistant", content: "" });
  const assistantIndex = messages.length - 1;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) consumeLine(line);
    if (answer && Date.now() - lastRender > 180) {
      messages[assistantIndex].content = cleanCharacterReply(answer);
      renderMessages();
      lastRender = Date.now();
    }
    if (done) break;
  }
  if (buffer) consumeLine(buffer);
  const finalAnswer = cleanCharacterReply(answer);
  if (!finalAnswer) throw new Error("The model returned an empty reply. Try again or choose another free model.");
  messages[assistantIndex].content = finalAnswer;
  saveConversation();
  renderMessages();
  return finalAnswer;
}

$("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("userMessage").value.trim();
  if (!text || waiting) return;
  if (!character) {
    setChatStatus("Create and save a character first.");
    switchPanel("character");
    return;
  }
  if (!getApiBase()) {
    setChatStatus("Connect your Cloudflare Worker first.");
    $("apiBase").focus();
    return;
  }
  if (messages.some((message) => message.role === "user" && message.failed)) {
    setChatStatus("Please resend the failed message before sending a new one.");
    return;
  }
  const userMessageIndex = messages.push({ role: "user", content: text, failed: false }) - 1;
  $("userMessage").value = "";
  renderMessages();
  saveConversation();
  waiting = true;
  $("sendBtn").disabled = true;
  $("userMessage").disabled = true;
  setChatStatus("Connecting to OpenRouter…");
  try {
    await streamReply();
    messages[userMessageIndex].failed = false;
    saveConversation();
    renderMessages();
    setChatStatus("Reply received. Continue your roleplay whenever you're ready.");
  } catch (error) {
    if (messages.at(-1)?.role === "assistant") messages.pop();
    messages[userMessageIndex].failed = true;
    saveConversation();
    renderMessages();
    setChatStatus(error.message + " Tap Resend beneath your message to try again.");
  } finally {
    waiting = false;
    $("sendBtn").disabled = false;
    $("userMessage").disabled = false;
    renderMessages();
    $("userMessage").focus();
  }
});

async function retryMessage(messageIndex) {
  const message = messages[messageIndex];
  if (!message || message.role !== "user" || !message.failed || waiting) return;
  if (messageIndex !== messages.length - 1) {
    setChatStatus("Please retry the most recent failed message first.");
    return;
  }

  waiting = true;
  $("sendBtn").disabled = true;
  $("userMessage").disabled = true;
  renderMessages();
  setChatStatus("Resending your message…");
  try {
    await streamReply();
    message.failed = false;
    saveConversation();
    renderMessages();
    setChatStatus("Reply received. Continue your roleplay whenever you're ready.");
  } catch (error) {
    if (messages.at(-1)?.role === "assistant") messages.pop();
    message.failed = true;
    saveConversation();
    renderMessages();
    setChatStatus(error.message + " Tap Resend beneath your message to try again.");
  } finally {
    waiting = false;
    $("sendBtn").disabled = false;
    $("userMessage").disabled = false;
    renderMessages();
    $("userMessage").focus();
  }
}

$("clearChat").addEventListener("click", () => {
  if (!confirm("Clear this character's conversation from this browser?")) return;
  messages = [];
  saveConversation();
  renderMessages();
  setChatStatus("Conversation cleared.");
});


// Manual, story-aware Pollinations image generation.
// The BYOP access token is held in memory only; the public App Key is not a secret.
const POLLINATIONS_APP_KEY_STORAGE = "studioChat.pollinationsClientId.v1";
const IMAGE_DB_NAME = "studioChatImageLibrary";
const IMAGE_DB_VERSION = 1;
let pollinationsAccessToken = null;
let imageModelCatalog = [];
let currentGeneratedImageUrl = null;

function getImageDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("This browser does not support the local image gallery."));
    const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the local image gallery."));
  });
}
async function saveStoredImage(record) {
  const db = await getImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not save the image.")); };
  });
}
async function getStoredImage(id) {
  if (!id) return null;
  const db = await getImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const request = tx.objectStore("images").get(id);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
async function getAllStoredImages() {
  const db = await getImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const request = tx.objectStore("images").getAll();
    request.onsuccess = () => { db.close(); resolve((request.result || []).sort((a, b) => b.createdAt - a.createdAt)); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
async function deleteStoredImage(id) {
  const db = await getImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
function makeId() {
  return (crypto.randomUUID ? crypto.randomUUID() : "img-" + Date.now() + "-" + Math.random().toString(36).slice(2));
}
function randomBase64Url(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  let binary = "";
  values.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  new Uint8Array(digest).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function pollinationsRedirectUri() {
  return location.origin + location.pathname;
}
function setImageAuthStatus(message) {
  $("imageAuthStatus").textContent = message;
}
async function beginPollinationsConnection() {
  try {
    const clientId = $("pollinationsClientId").value.trim();
    if (clientId && !clientId.startsWith("pk_")) {
      setImageAuthStatus("The App Key should start with pk_. You can also leave it blank.");
      return;
    }
    if (clientId) localStorage.setItem(POLLINATIONS_APP_KEY_STORAGE, clientId);
    const verifier = randomBase64Url(32);
    const challenge = await sha256Base64Url(verifier);
    const state = randomBase64Url(24);
    const redirectUri = pollinationsRedirectUri();
    sessionStorage.setItem("studioChat.pollinationsPkce.v1", JSON.stringify({ verifier, state, redirectUri }));
    const params = new URLSearchParams({
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "usage",
      models: "image",
      budget: "5",
      expiry: "7",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    if (clientId) params.set("client_id", clientId);
    setImageAuthStatus("Opening Pollinations consent. Review the image permission and spending budget before approving…");
    location.href = "https://enter.pollinations.ai/authorize?" + params.toString();
  } catch (error) {
    setImageAuthStatus("Could not start Pollinations connection: " + error.message);
  }
}
async function handlePollinationsCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const oauthError = params.get("error");
  if (!code && !oauthError) return;
  const saved = sessionStorage.getItem("studioChat.pollinationsPkce.v1");
  history.replaceState({}, document.title, location.pathname);
  if (oauthError) {
    sessionStorage.removeItem("studioChat.pollinationsPkce.v1");
    setImageAuthStatus("Pollinations authorization was not completed: " + (params.get("error_description") || oauthError));
    return;
  }
  let pkce;
  try { pkce = saved ? JSON.parse(saved) : null; } catch { pkce = null; }
  if (!pkce || params.get("state") !== pkce.state) {
    setImageAuthStatus("The Pollinations sign-in could not be verified. Please connect again.");
    return;
  }
  sessionStorage.removeItem("studioChat.pollinationsPkce.v1");
  setImageAuthStatus("Finishing secure Pollinations connection…");
  try {
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pkce.redirectUri,
      code_verifier: pkce.verifier
    });
    const clientId = $("pollinationsClientId").value.trim() || localStorage.getItem(POLLINATIONS_APP_KEY_STORAGE) || "";
    if (clientId) tokenParams.set("client_id", clientId);
    const response = await fetch("https://enter.pollinations.ai/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Token exchange failed.");
    pollinationsAccessToken = data.access_token;
    setImageAuthStatus("Connected. Your authorized image budget is controlled by Pollinations. You can generate when ready.");
  } catch (error) {
    setImageAuthStatus("Connection failed: " + error.message + " Please try connecting again.");
  }
}
async function loadPollinationsImageModels() {
  const select = $("imageModelSelect");
  try {
    const response = await fetch("https://gen.pollinations.ai/image/models");
    if (!response.ok) throw new Error("Image model catalogue returned HTTP " + response.status);
    const data = await response.json();
    const models = Array.isArray(data) ? data : (data.data || data.models || []);
    imageModelCatalog = models.filter((model) => model && (model.id || model.model));
    select.replaceChildren();
    const preferred = ["tongyi-mai/z-image-turbo", "black-forest-labs/flux.1-schnell"];
    imageModelCatalog.sort((a, b) => {
      const ai = preferred.indexOf(a.id || a.model);
      const bi = preferred.indexOf(b.id || b.model);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    for (const model of imageModelCatalog) {
      const id = model.id || model.model;
      const option = document.createElement("option");
      option.value = id;
      option.textContent = model.name || model.title || id;
      select.append(option);
    }
    if (!imageModelCatalog.length) throw new Error("No image models were returned.");
    select.value = imageModelCatalog.some((model) => (model.id || model.model) === preferred[0]) ? preferred[0] : (imageModelCatalog[0].id || imageModelCatalog[0].model);
  } catch (error) {
    select.replaceChildren();
    const option = document.createElement("option");
    option.value = "tongyi-mai/z-image-turbo";
    option.textContent = "Z-Image Turbo (default)";
    select.append(option);
    $("imageStatus").textContent = "Could not load the live model list. A default model is available; " + error.message;
  }
}
function buildStoryImagePrompt() {
  if (!character) {
    $("imagePrompt").value = $("imageSceneNotes").value.trim();
    $("imageStatus").textContent = "No character profile is saved. Add your own prompt, then generate.";
    return;
  }
  const recent = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-6)
    .map((message) => (message.role === "user" ? "User: " : character.name + ": ") + String(message.content || "").slice(-650))
    .join("\n");
  const parts = [
    "Create one coherent visual scene for an ongoing fictional roleplay. Treat the following as visual reference, not text to print in the image.",
    "CHARACTER IDENTITY — keep these stable across images:",
    character.name + ", age " + character.age + ".",
    "Appearance: " + (character.appearance || "Use a consistent appearance appropriate to the scene."),
    "PERSONALITY AND WORLD:",
    character.personality || "Not specified.",
    character.background || "Not specified.",
    "STORY SETUP:",
    character.scenario || "Continue the established roleplay naturally.",
    "CURRENT SCENE DETAILS:",
    $("imageSceneNotes").value.trim() || "Infer the current outfit, condition, pose, expression, and location from the latest story events.",
    "RECENT STORY EVENTS — use these to understand the current moment:",
    recent || "No conversation yet; depict the opening scenario.",
    "VISUAL CONTINUITY: Preserve the character's defining facial features, complexion, hairstyle, body type, and other permanent traits. Let clothing, pose, expression, and location reflect the current scene rather than changing the character's identity.",
    "IMAGE DIRECTION: cinematic, detailed composition, coherent anatomy, natural lighting, expressive but believable body language. Do not include captions, dialogue, lettering, logos, or watermarks."
  ];
  $("imagePrompt").value = parts.filter(Boolean).join("\n\n");
  $("imageStatus").textContent = "Prompt built from the character profile and the latest " + Math.min(6, messages.filter((message) => message.role === "user" || message.role === "assistant").length) + " story messages. Review and edit it before generating.";
}
function imageDimensions(ratio) {
  const sizes = {
    "3:4": [768, 1024],
    "2:3": [768, 1152],
    "1:1": [1024, 1024],
    "4:3": [1024, 768],
    "16:9": [1152, 648]
  };
  return sizes[ratio] || sizes["3:4"];
}
async function renderImageGallery() {
  const gallery = $("imageGallery");
  try {
    const records = await getAllStoredImages();
    gallery.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("p");
      empty.className = "gallery-empty";
      empty.textContent = "Your generated images will appear here.";
      gallery.append(empty);
      return;
    }
    for (const record of records) {
      const card = document.createElement("article");
      card.className = "gallery-card";
      const img = document.createElement("img");
      img.alt = "Saved generated image";
      img.src = URL.createObjectURL(record.blob);
      const meta = document.createElement("div");
      meta.className = "gallery-meta";
      const date = document.createElement("span");
      date.textContent = new Date(record.createdAt).toLocaleString();
      const download = document.createElement("a");
      download.href = img.src;
      download.download = "studio-chat-" + record.id + ".png";
      download.textContent = "Save";
      meta.append(date, download);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await deleteStoredImage(record.id);
        renderImageGallery();
      });
      card.append(img, meta, remove);
      gallery.append(card);
    }
  } catch (error) {
    gallery.textContent = "Local gallery unavailable: " + error.message;
  }
}
async function generateStoryImage() {
  if (!pollinationsAccessToken) {
    setImageAuthStatus("Connect Pollinations first. Your image-generation permission is not active in this tab.");
    return;
  }
  const prompt = $("imagePrompt").value.trim();
  if (!prompt) {
    $("imageStatus").textContent = "Build a prompt from the story or write one before generating.";
    return;
  }
  const button = $("generateImageBtn");
  button.disabled = true;
  button.textContent = "Generating…";
  $("imageStatus").textContent = "Sending your prompt to Pollinations. This may take a little while…";
  try {
    const [width, height] = imageDimensions($("imageRatioSelect").value);
    const params = new URLSearchParams({
      model: $("imageModelSelect").value || "tongyi-mai/z-image-turbo",
      width: String(width),
      height: String(height)
    });
    const url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt) + "?" + params.toString();
    const response = await fetch(url, { headers: { Authorization: "Bearer " + pollinationsAccessToken } });
    if (response.status === 401) {
      pollinationsAccessToken = null;
      throw new Error("Pollinations authorization expired or was revoked. Connect again.");
    }
    if (response.status === 402) throw new Error("The authorized Pollen budget is empty or too low. Review your Pollinations balance and consent budget.");
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Pollinations returned HTTP " + response.status + (detail ? ": " + detail.slice(0, 220) : ""));
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("Pollinations returned an unexpected file type: " + (blob.type || "unknown"));
    const id = makeId();
    const record = {
      id,
      blob,
      prompt,
      model: $("imageModelSelect").value,
      width,
      height,
      createdAt: Date.now()
    };
    await saveStoredImage(record);
    if (currentGeneratedImageUrl) URL.revokeObjectURL(currentGeneratedImageUrl);
    currentGeneratedImageUrl = URL.createObjectURL(blob);
    $("generatedImage").src = currentGeneratedImageUrl;
    $("downloadGeneratedImage").href = currentGeneratedImageUrl;
    $("downloadGeneratedImage").download = "studio-chat-" + id + (blob.type.includes("png") ? ".png" : ".jpg");
    $("imageOutput").hidden = false;
    if (character) {
      messages.push({ role: "image", content: prompt, imageId: id, model: record.model });
      saveConversation();
      renderMessages();
    }
    await renderImageGallery();
    $("imageStatus").textContent = "Image generated and saved in your local gallery." + (character ? " It was also added to this conversation." : "");
  } catch (error) {
    $("imageStatus").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Generate image";
  }
}
$("savePollinationsClientId").addEventListener("click", () => {
  const clientId = $("pollinationsClientId").value.trim();
  if (clientId && !clientId.startsWith("pk_")) {
    setImageAuthStatus("The App Key should start with pk_, or leave it blank.");
    return;
  }
  if (clientId) localStorage.setItem(POLLINATIONS_APP_KEY_STORAGE, clientId);
  else localStorage.removeItem(POLLINATIONS_APP_KEY_STORAGE);
  setImageAuthStatus(clientId ? "App Key saved on this device. Tap Connect Pollinations to authorize." : "App Key cleared. You can still try connecting without one.");
});
$("connectPollinations").addEventListener("click", beginPollinationsConnection);
$("buildImagePrompt").addEventListener("click", buildStoryImagePrompt);
$("generateImageBtn").addEventListener("click", generateStoryImage);
$("openImageComposer").addEventListener("click", () => {
  switchPanel("image");
  buildStoryImagePrompt();
});
$("pollinationsClientId").value = localStorage.getItem(POLLINATIONS_APP_KEY_STORAGE) || "";
loadPollinationsImageModels();
renderImageGallery();
handlePollinationsCallback();

if (character) {
  $("charName").value = character.name || "";
  $("charAge").value = character.age || 18;
  $("charAppearance").value = character.appearance || "";
  $("charPersonality").value = character.personality || "";
  $("charBackground").value = character.background || "";
  $("charScenario").value = character.scenario || "";
  $("roleplayStyle").value = character.style || "Cinematic, descriptive prose with dialogue";
  $("contentMode").value = character.content || "Mature horror and adult consensual fictional roleplay are both allowed. All characters are adults and consent is respected.";
}
const savedApiBase = getApiBase();
if (savedApiBase) $("apiBase").value = savedApiBase;
renderCharacter();
renderMessages();
if (savedApiBase) connectWorker();

// Cache only the Studio Chat app shell. The Worker and OpenRouter require internet access.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker:", err));
  });
}
