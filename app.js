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
    loadHordeImageModels();
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


// Manual, story-aware AI Horde image generation.
// The AI Horde API key stays in the Cloudflare Worker secret.
const IMAGE_DB_NAME = "studioChatImageLibrary";
const IMAGE_DB_VERSION = 1;
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
function setImageAuthStatus(message) {
  $("imageAuthStatus").textContent = message;
}
async function loadHordeImageModels() {
  const select = $("imageModelSelect");
  try {
    const response = await apiFetch("/api/images/models");
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models : [];
    if (!models.length) throw new Error("No image models are currently available.");
    select.replaceChildren();
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.name;
      option.textContent = model.name + (model.count ? " · " + model.count + " workers" : "");
      select.append(option);
    }
    select.value = models.some((model) => model.name === "stable_diffusion") ? "stable_diffusion" : models[0].name;
    setImageAuthStatus(data.configured ? ("AI Horde connected through your Cloudflare Worker. " + models.length + " active image models found.") : "Models are listed, but the Worker is missing AI_HORDE_API_KEY. Add the secret in Cloudflare before generating.");
  } catch (error) {
    setImageAuthStatus("AI Horde is not ready yet. Add the AI_HORDE_API_KEY Worker secret, then reconnect. " + error.message);
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
  $("imageStatus").textContent = "Prompt built from the character profile and recent story messages. Review and edit it before generating.";
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
  if (!getApiBase()) {
    setImageAuthStatus("Connect your Cloudflare Worker in the Chat tab first.");
    switchPanel("chat");
    return;
  }
  const prompt = $("imagePrompt").value.trim();
  if (!prompt) {
    $("imageStatus").textContent = "Build a prompt from the story or write one before generating.";
    return;
  }
  const button = $("generateImageBtn");
  button.disabled = true;
  button.textContent = "Queuing…";
  let requestId = null;
  try {
    const [width, height] = imageDimensions($("imageRatioSelect").value);
    const submitResponse = await apiFetch("/api/images/submit", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        model: $("imageModelSelect").value || "stable_diffusion",
        width,
        height
      })
    });
    const submitted = await submitResponse.json();
    requestId = submitted.id;
    if (!requestId) throw new Error(submitted.error || "AI Horde did not return a generation ID.");
    $("imageStatus").textContent = "Queued on AI Horde. Waiting for a volunteer worker…";
    button.textContent = "Waiting…";

    const startedAt = Date.now();
    let status = null;
    while (Date.now() - startedAt < 8 * 60 * 1000) {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const statusResponse = await apiFetch("/api/images/status/" + encodeURIComponent(requestId));
      status = await statusResponse.json();
      if (status.done) break;
      const queue = Number.isFinite(status.queue_position) ? " Queue position: " + status.queue_position + "." : "";
      const wait = Number.isFinite(status.wait_time) && status.wait_time > 0 ? " Estimated wait: " + Math.ceil(status.wait_time) + "s." : "";
      $("imageStatus").textContent = "AI Horde is processing your image." + queue + wait;
    }
    if (!status?.done) throw new Error("This generation is still queued after 8 minutes. Your request ID is " + requestId + ". You can try again later.");
    if (status.faulted) throw new Error("AI Horde could not complete this request. Try another model or a simpler prompt.");
    button.textContent = "Downloading…";
    $("imageStatus").textContent = "Generation finished. Downloading your image…";
    const imageResponse = await apiFetch("/api/images/result/" + encodeURIComponent(requestId));
    const blob = await imageResponse.blob();
    if (!blob.type.startsWith("image/")) throw new Error("AI Horde returned an unexpected file type: " + (blob.type || "unknown"));
    const id = makeId();
    const record = { id, blob, prompt, model: $("imageModelSelect").value, width, height, createdAt: Date.now() };
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
$("refreshHordeModels").addEventListener("click", loadHordeImageModels);
$("buildImagePrompt").addEventListener("click", buildStoryImagePrompt);
$("generateImageBtn").addEventListener("click", generateStoryImage);
$("openImageComposer").addEventListener("click", () => {
  switchPanel("image");
  buildStoryImagePrompt();
});
renderImageGallery();


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
