const $ = (id) => document.getElementById(id);

// Tab navigation: keep all tool pages loaded so a chat session isn't reset
// just because the user switches tabs.
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === button));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === button.dataset.panel));
  });
});

// PWA installation prompt. Browsers decide when the prompt is available.
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("installBtn").hidden = false;
});
$("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("installBtn").hidden = true;
});
window.addEventListener("appinstalled", () => {
  $("installBtn").hidden = true;
  deferredInstallPrompt = null;
});

// Help dialog
const dialog = $("installHelp");
$("helpInstall").addEventListener("click", () => dialog.showModal());
$("closeHelp").addEventListener("click", () => dialog.close());
$("okHelp").addEventListener("click", () => dialog.close());

// Register the offline app shell. Perchance itself still requires internet.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker:", err));
  });
}

// Perchance image iframe + postMessage integration.
// The message is accepted only from the expected Perchance origin and only
// when it carries the matching request id.
function requestId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
function warmPerchance() {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Perchance connection";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0";
    const timeout = setTimeout(() => {
      frame.remove();
      // A load event can be blocked by browser privacy features; continue to
      // the actual request, which will report a useful error if blocked.
      resolve();
    }, 10000);
    frame.onload = () => { clearTimeout(timeout); frame.remove(); resolve(); };
    frame.onerror = () => { clearTimeout(timeout); frame.remove(); reject(new Error("Could not reach Perchance.")); };
    frame.src = "https://perchance.org";
    document.body.appendChild(frame);
  });
}
function generatePerchanceImage(prompt, resolution, seed) {
  return new Promise((resolve, reject) => {
    const id = requestId();
    const params = new URLSearchParams({ prompt, format: "json", id, resolution });
    if (seed !== "") params.set("seed", seed);
    const frame = document.createElement("iframe");
    frame.title = "Perchance image request";
    frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0";
    let finished = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timeout);
      frame.remove();
    };
    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      cleanup();
      fn(value);
    };
    const onMessage = (event) => {
      if (event.origin !== "https://perchance.org") return;
      const data = event.data || {};
      if (data.api !== "perchance-image-api" || !data.result || data.result.id !== id) return;
      if (data.result.ok && (data.result.url || data.result.dataUrl)) finish(resolve, data.result);
      else finish(reject, new Error(data.result.error || data.result.message || "Perchance could not generate this image."));
    };
    const timeout = setTimeout(() => finish(reject, new Error("Timed out. Try again or open Perchance's image generator directly.")), 180000);
    window.addEventListener("message", onMessage);
    frame.src = "https://perchance.org/perchance-ai-api?" + params.toString();
    document.body.appendChild(frame);
  });
}

$("generateBtn").addEventListener("click", async () => {
  const prompt = $("prompt").value.trim();
  if (!prompt) {
    $("imageStatus").textContent = "Enter an image prompt first.";
    $("prompt").focus();
    return;
  }
  const button = $("generateBtn");
  button.disabled = true;
  $("imageOutput").hidden = true;
  $("imageStatus").textContent = "Connecting to Perchance...";
  try {
    await warmPerchance();
    $("imageStatus").textContent = "Generating your image. Please keep this page open...";
    const result = await generatePerchanceImage(prompt, $("resolution").value, $("seed").value.trim());
    const imageUrl = result.url || result.dataUrl;
    $("generatedImage").src = imageUrl;
    $("openImage").href = imageUrl;
    $("downloadImage").href = imageUrl;
    $("imageOutput").hidden = false;
    $("imageStatus").textContent = "Image generated successfully.";
  } catch (error) {
    $("imageStatus").textContent = `Could not generate image: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
