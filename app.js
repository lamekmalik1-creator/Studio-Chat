const $ = (id) => document.getElementById(id);
const STORAGE_CHARACTER = "studioChat.character.v1";
const STORAGE_MESSAGES = "studioChat.messages.v1";
const API = "https://aihorde.net/api/v2";
const API_KEY = "0000000000"; // AI Horde's published anonymous key; no private key is stored here.
const CLIENT_AGENT = "StudioChat:1.0:https://github.com/lamekmalik1-creator/Studio-Chat";

let character = loadJSON(STORAGE_CHARACTER, null);
let messages = loadJSON(STORAGE_MESSAGES, []);
let waiting = false;

function loadJSON(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { setChatStatus("This browser could not save local chat history."); }
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
  box.innerHTML = "";
  const name = document.createElement("strong");
  name.textContent = character.name + " · " + character.age;
  const details = document.createElement("span");
  details.textContent = [character.appearance, character.personality, character.scenario].filter(Boolean).join(" · ");
  box.append(name, details);
}
function renderMessages() {
  const log = $("chatLog");
  log.innerHTML = "";
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.textContent = "Your roleplay will appear here. Send the first message to begin.";
    log.append(empty);
    return;
  }
  for (const message of messages) {
    const item = document.createElement("div");
    item.className = "chat-message " + (message.role === "user" ? "from-user" : "from-character");
    const label = document.createElement("strong");
    label.textContent = message.role === "user" ? "You" : (character?.name || "Character");
    const body = document.createElement("p");
    body.textContent = message.content;
    item.append(label, body);
    log.append(item);
  }
  log.scrollTop = log.scrollHeight;
}
function saveConversation() { saveJSON(STORAGE_MESSAGES, messages.slice(-40)); }

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
  setChatStatus("Ready. Your first reply may take longer while a volunteer worker picks up the request.");
});

function buildPrompt() {
  const recent = messages.slice(-12).map((m) =>
    (m.role === "user" ? "[USER MESSAGE]" : "[CHARACTER REPLY]") + "\n" + m.content
  ).join("\n\n");
  return [
    "You are an interactive roleplay character. You must write ONLY the next message spoken by the character. Never write, invent, quote, or continue the user's side of the conversation.",
    "Do not output labels such as User:, You:, Human:, or ### User:. Do not narrate the user's actions, words, thoughts, or feelings. Do not write a sample dialogue or multiple turns.",
    "Write one natural character response, then STOP. Output only the character's words and actions, without a speaker heading.",
    "CHARACTER PROFILE",
    "Name: " + character.name,
    "Age: " + character.age + " (an adult)",
    "Appearance: " + (character.appearance || "Not specified"),
    "Personality: " + (character.personality || "Develop a consistent personality from the scenario"),
    "Background: " + (character.background || "Not specified"),
    "Current scenario: " + (character.scenario || "Begin a natural conversation with the user"),
    "Writing style: " + character.style,
    "Content guidance: " + character.content,
    "Rules: All characters involved in adult situations are adults aged 18 or older. Respect consent. Never decide the user's actions or thoughts. Do not break character unless asked. Fictional horror and zombie themes are welcome.",
    "CONVERSATION HISTORY (use only for context; do not repeat or continue either side):",
    recent || "No messages yet.",
    "NOW WRITE ONLY " + character.name + "'S NEXT REPLY. Do not write the user's reply."
  ].join("\n\n");
}

function cleanCharacterReply(raw) {
  let answer = String(raw || "").trim();
  // Remove a leading character-name heading if the model adds one.
  answer = answer.replace(new RegExp("^\\s*(?:#{1,6}\\s*)?" + character.name.replace(/[.*+?^\\x24{}()|[\\]\\\\]/g, "\\\\function buildPrompt() {
  const recent = messages.slice(-12).map((m) =>
    (m.role === "user" ? "User" : character.name) + ": " + m.content
  ).join("\n");
  return [
    "### Instruction:",
    "You are roleplaying as the fictional character described below. Stay in character and write immersive, coherent replies.",
    "Character name: " + character.name,
    "Age: " + character.age + " (an adult)",
    "Appearance: " + (character.appearance || "Not specified"),
    "Personality: " + (character.personality || "Develop a consistent personality from the scenario"),
    "Background: " + (character.background || "Not specified"),
    "Current scenario: " + (character.scenario || "Begin a natural conversation with the user"),
    "Writing style: " + character.style,
    "Content guidance: " + character.content,
    "Roleplay rules: All characters involved in adult situations are adults aged 18 or older. Respect consent. Never change the user's dialogue or decide the user's actions or thoughts. Do not break character unless asked. For horror, use suspense and atmosphere; fictional horror and zombie themes are welcome.",
    "### Roleplay so far:",
    recent || "No messages yet.",
    "### " + character.name + ":"
  ].join("\n");
}") + "\\s*:\\s*", "i"), "");
  // Some text models continue the scene by writing the user's next turn. Keep only the character's reply.
  answer = answer.replace(/\\n\\s*(?:#{1,6}\\s*)?(?:user|you|human)\\s*:[\\s\\S]*$/i, "");
  return answer.trim();
}

async function hordeRequest(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      "apikey": API_KEY,
      "Client-Agent": CLIENT_AGENT,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || ("AI Horde returned HTTP " + response.status));
  return data;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateReply() {
  const submitted = await hordeRequest("/generate/text/async", {
    method: "POST",
    body: JSON.stringify({
      prompt: buildPrompt(),
      params: {
        max_context_length: 2048,
        max_length: 220,
        temperature: 0.9,
        top_p: 0.92,
        rep_pen: 1.08
      }
    })
  });
  if (!submitted.id) throw new Error(submitted.message || "The API did not return a request ID.");
  setChatStatus(submitted.message || "Request queued. Waiting for a free text-generation worker…");
  const started = Date.now();
  while (Date.now() - started < 8 * 60 * 1000) {
    await pause(3500);
    const status = await hordeRequest("/generate/text/status/" + encodeURIComponent(submitted.id));
    if (status.faulted) throw new Error("The volunteer worker could not complete this reply. Please try again.");
    if (status.done) {
      const rawAnswer = status.generations?.find((g) => g.text)?.text || "";
      const answer = cleanCharacterReply(rawAnswer);
      if (!answer) throw new Error("The worker did not return a character-only reply. Please try again.");
      return answer;
    }
    const position = Number.isFinite(status.queue_position) ? " Queue position: " + status.queue_position + "." : "";
    const wait = Number.isFinite(status.wait_time) ? " Estimated wait: " + Math.ceil(status.wait_time) + "s." : "";
    setChatStatus("Waiting for a free community worker…" + position + wait);
  }
  throw new Error("This request is taking too long. The free worker queue may be busy. Please try again later.");
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
  waiting = true;
  $("sendBtn").disabled = true;
  $("userMessage").disabled = true;
  messages.push({ role: "user", content: text });
  $("userMessage").value = "";
  renderMessages();
  saveConversation();
  setChatStatus("Sending your message to AI Horde…");
  try {
    const answer = await generateReply();
    messages.push({ role: "assistant", content: answer });
    messages = messages.slice(-40);
    saveConversation();
    renderMessages();
    setChatStatus("Reply received. Continue your roleplay whenever you're ready.");
  } catch (error) {
    setChatStatus(error.message + " Your message is still in the conversation; you can retry by sending another message.");
  } finally {
    waiting = false;
    $("sendBtn").disabled = false;
    $("userMessage").disabled = false;
    $("userMessage").focus();
  }
});

$("clearChat").addEventListener("click", () => {
  if (!confirm("Clear this character's conversation from this browser?")) return;
  messages = [];
  saveConversation();
  renderMessages();
  setChatStatus("Conversation cleared.");
});

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
renderCharacter();
renderMessages();

// Cache only the Studio Chat app shell. The AI Horde API requires internet access.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker:", err));
  });
}
