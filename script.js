const chatBox = document.getElementById("chatBox");
const micBtn = document.getElementById("micBtn");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const addBtn = document.getElementById("addBtn");
const addFilesDropdown = document.getElementById("addFilesDropdown");
const attachmentList = document.getElementById("attachmentList");
const filePickers = {
  files: document.getElementById("filePicker"),
  images: document.getElementById("imagePicker"),
  code: document.getElementById("codePicker"),
};
let selectedAttachments = [];
const configuredApiUrl = document
  .querySelector('meta[name="nico-api-url"]')
  ?.content.trim();
const apiBaseUrl =
  configuredApiUrl || `http://${window.location.hostname || "127.0.0.1"}:8000`;
const supabaseUrl = document.querySelector(
  'meta[name="supabase-url"]',
)?.content;
const supabaseAnonKey = document.querySelector(
  'meta[name="supabase-anon-key"]',
)?.content;
const authClient =
  window.supabase &&
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseAnonKey !== "YOUR_SUPABASE_PUBLISHABLE_KEY"
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
let currentUser = null;
let authUiInitialized = false;
let conversationLoadToken = 0;
const settingsStorageKey = "nico_settings";
const defaultSettings = {
  personality: "professional",
  length: "short",
  theme: "midnight",
  mode: "dark",
  font: "sans",
  fontScale: 100,
  model: "light",
  memory: true,
  memoryText: "",
  context: true,
  sound: false,
  avatar: "✦",
};
let settings = { ...defaultSettings };

try {
  settings = {
    ...defaultSettings,
    ...JSON.parse(localStorage.getItem(settingsStorageKey) || "{}"),
  };
} catch {
  settings = { ...defaultSettings };
}

function saveSettings() {
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
}

function applySettings() {
  document.body.classList.toggle("theme-light", settings.mode === "light");
  document.body.classList.toggle(
    "theme-cyberpunk",
    settings.theme === "cyberpunk",
  );
  document.body.classList.toggle("theme-sunset", settings.theme === "sunset");
  document.body.classList.toggle(
    "theme-cotton-candy",
    settings.personality === "mica",
  );
  document.body.classList.toggle("font-mono", settings.font === "mono");
  document.documentElement.style.setProperty(
    "--font-scale",
    settings.fontScale / 100,
  );
  document.documentElement.style.fontSize = `${settings.fontScale}%`;
  const mascotLogo = document.getElementById("mascotLogo");
  const brandName = document.getElementById("brandName");
  const modelBadge = document.querySelector(".model-badge");
  const mascotPreview = document.getElementById("mascotPreview");
  if (mascotLogo) mascotLogo.textContent = settings.avatar;
  if (brandName)
    brandName.textContent = settings.personality === "mica" ? "MICA" : "NICO";
  if (modelBadge)
    modelBadge.textContent =
      settings.personality === "mica"
        ? "Mica • Nurturing mode"
        : "Nico v2 • System OS";
  if (mascotPreview)
    mascotPreview.firstChild.textContent = `${settings.avatar} `;
  document.querySelectorAll(".avatar-tag").forEach((tag) => {
    tag.textContent = settings.avatar;
  });
}

async function apiFetch(url, options = {}) {
  if (!authClient) throw new Error("Supabase authentication is not configured");
  const { data } = await authClient.auth.getSession();
  if (!data.session) throw new Error("Sign-in required");

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(url, { ...options, headers });
}

function conversationStorageKey() {
  return currentUser ? `active_chat_id:${currentUser.id}` : "active_chat_id";
}

function persistCurrentConversationId() {
  localStorage.setItem("active_chat_id", currentConversationId);
  if (currentUser) {
    localStorage.setItem(
      `active_chat_id:${currentUser.id}`,
      currentConversationId,
    );
  }
}

function attachmentStorageKey(conversationId = currentConversationId) {
  return `conversation_attachments:${conversationId}`;
}

async function createStoredImagePreview(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 640 / image.width, 640 / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

async function saveConversationAttachments(attachments) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(attachmentStorageKey()) || "[]",
    );
    const normalized = await Promise.all(
      attachments.map(async (attachment) => {
        if (attachment.mime_type.startsWith("image/")) {
          return {
            name: attachment.name,
            mime_type: attachment.mime_type,
            data_url: await createStoredImagePreview(attachment.data_url),
          };
        }
        return {
          name: attachment.name,
          mime_type: attachment.mime_type,
          data_url: attachment.data_url || "",
        };
      }),
    );

    stored.push(normalized);
    localStorage.setItem(
      attachmentStorageKey(),
      JSON.stringify(stored.slice(-50)),
    );
  } catch (error) {
    console.warn("Could not persist attachments:", error);
  }
}

function loadConversationAttachments() {
  try {
    return JSON.parse(localStorage.getItem(attachmentStorageKey()) || "[]");
  } catch {
    return [];
  }
}

function createConversationId() {
  if (crypto.randomUUID) return crypto.randomUUID();

  if (crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes]
      .map((byte, index) =>
        [4, 6, 8, 10].includes(index)
          ? `-${byte.toString(16).padStart(2, "0")}`
          : byte.toString(16).padStart(2, "0"),
      )
      .join("")
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  }

  return "00000000-0000-4000-8000-000000000000";
}

const savedConversationId = localStorage.getItem("active_chat_id");
function isValidConversationId(value) {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}
let currentConversationId = isValidConversationId(savedConversationId)
  ? savedConversationId
  : createConversationId();
localStorage.setItem("active_chat_id", currentConversationId);

let recognition;
let isListening = false;
let silenceTimer;
let currentAbortController = null;

// TTS Queue State & Master Toggle
let speechQueue = [];
let isSpeaking = false;
let ttsEnabled = false;

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isListening = true;
    if (micBtn) micBtn.classList.add("recording");
  };

  recognition.onend = () => {
    isListening = false;
    if (micBtn) micBtn.classList.remove("recording");
    if (userInput.value.trim()) sendMessage();
  };

  recognition.onresult = (event) => {
    let currentTranscript = "";
    for (let i = 0; i < event.results.length; ++i) {
      currentTranscript += event.results[i][0].transcript;
    }

    if (currentTranscript.trim()) {
      currentTranscript = currentTranscript.replace(
        /\b(niko|miko|neeko|neko)\b/gi,
        "Nico",
      );
      userInput.value = currentTranscript;

      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        recognition.stop();
      }, 1200);
    }
  };
} else if (micBtn) {
  micBtn.disabled = true;
}

function toggleSpeech() {
  if (!recognition) return;
  if (isListening) {
    clearTimeout(silenceTimer);
    recognition.stop();
  } else {
    userInput.value = "";
    recognition.start();
  }
}

if (micBtn) {
  micBtn.onclick = toggleSpeech;
}

document.addEventListener("click", (event) => {
  if (!addFilesDropdown) return;
  if (
    !event.target.closest("#addBtn") &&
    !event.target.closest("#addFilesDropdown")
  ) {
    addFilesDropdown.classList.remove("open");
    addFilesDropdown.setAttribute("aria-hidden", "true");
    addBtn?.setAttribute("aria-expanded", "false");
  }
});

if (addBtn) {
  addBtn.addEventListener("click", () => {
    const isOpen = addFilesDropdown.classList.toggle("open");
    addFilesDropdown.setAttribute("aria-hidden", String(!isOpen));
    addBtn.setAttribute("aria-expanded", String(isOpen));
  });
}

function clearSelectedAttachments() {
  selectedAttachments = [];
  renderAttachments();
}

function renderAttachments() {
  if (!attachmentList) return;
  attachmentList.innerHTML = "";
  selectedAttachments.forEach((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    if (attachment.kind === "images" && attachment.previewUrl) {
      const preview = document.createElement("img");
      preview.className = "attachment-thumb";
      preview.src = attachment.previewUrl;
      preview.alt = "";
      chip.appendChild(preview);
    }

    const nameSpan = document.createElement("span");
    nameSpan.title = attachment.file.name;
    nameSpan.textContent = `${attachment.icon} ${attachment.file.name}`;
    chip.appendChild(nameSpan);

    const removeButton = document.createElement("button");
    removeButton.className = "attachment-remove";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${attachment.file.name}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      selectedAttachments.splice(index, 1);
      renderAttachments();
    });

    chip.appendChild(removeButton);
    attachmentList.appendChild(chip);
  });
}

function selectFiles(kind) {
  filePickers[kind]?.click();
  addFilesDropdown?.classList.remove("open");
  addFilesDropdown?.setAttribute("aria-hidden", "true");
  addBtn?.setAttribute("aria-expanded", "false");
}

function addSelectedFiles(kind, event) {
  const icon = kind === "images" ? "🖼️" : kind === "code" ? "⌘" : "📄";
  Array.from(event.target.files || []).forEach((file) => {
    if (
      !selectedAttachments.some(
        (attachment) =>
          attachment.file.name === file.name &&
          attachment.file.size === file.size,
      )
    ) {
      selectedAttachments.push({
        file,
        kind,
        icon,
        previewUrl: kind === "images" ? URL.createObjectURL(file) : null,
      });
    }
  });
  event.target.value = "";
  renderAttachments();
}

document
  .getElementById("addFilesBtn")
  ?.addEventListener("click", () => selectFiles("files"));
document
  .getElementById("addImagesBtn")
  ?.addEventListener("click", () => selectFiles("images"));
document
  .getElementById("addCodeBtn")
  ?.addEventListener("click", () => selectFiles("code"));
Object.entries(filePickers).forEach(([kind, picker]) => {
  picker?.addEventListener("change", (event) => addSelectedFiles(kind, event));
});

async function buildMessageWithAttachments(message) {
  if (selectedAttachments.length === 0) {
    return { message, displayMessage: message, attachments: [] };
  }
  const attachmentContext = [];
  const attachments = [];
  for (const attachment of selectedAttachments) {
    if (attachment.kind === "images") {
      const dataUrl = await readFileAsDataUrl(attachment.file);
      attachments.push({
        name: attachment.file.name,
        mime_type: attachment.file.type || "image/*",
        data_url: dataUrl,
      });
      continue;
    }

    if (isTextAttachment(attachment.file)) {
      try {
        const text = await attachment.file.text();
        const truncatedText =
          text.length > 12000
            ? `${text.slice(0, 12000)}\n[File truncated]`
            : text;
        attachmentContext.push(
          `Attached file: ${attachment.file.name}\n\`\`\`\n${truncatedText}\n\`\`\``,
        );
      } catch {
        attachmentContext.push(
          `[Could not read file: ${attachment.file.name}]`,
        );
      }
      continue;
    }

    const dataUrl = await readFileAsDataUrl(attachment.file);
    attachments.push({
      name: attachment.file.name,
      mime_type: attachment.file.type || "application/octet-stream",
      data_url: dataUrl,
    });
    attachmentContext.push(`[Attached binary file: ${attachment.file.name}]`);
  }
  return {
    message: `${message}\n\n${attachmentContext.join("\n\n")}`.trim(),
    displayMessage: message,
    attachments,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isTextAttachment(file) {
  return (
    file.type.startsWith("text/") ||
    /\.(c|cpp|css|html?|java|js|json|jsx|md|py|sql|ts|tsx|txt|xml|ya?ml)$/i.test(
      file.name,
    )
  );
}

/* Event-driven TTS Queueing - Updated to speak introductory text before code blocks */
function queueSentence(text) {
  if (!ttsEnabled || !("speechSynthesis" in window)) return;

  // Only strip markdown formatting symbols, but keep introductory text and explanations readable
  const cleanText = text
    .replace(/<[^>]*>/g, "")
    .replace(/```[\s\S]*?```/g, " Here is the code block.") // Speak a spoken cue instead of silently dropping or reading raw code
    .replace(/[\*\_`#]/g, "")
    .trim();

  if (!cleanText) return;

  speechQueue.push(cleanText);
  processSpeechQueue();
}

function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;

  isSpeaking = true;
  const textToSpeak = speechQueue.shift();
  const utterance = new SpeechSynthesisUtterance(textToSpeak);

  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const preferredVoice =
    voices.find(
      (v) =>
        v.lang.includes("en") &&
        (v.name.includes("Natural") || v.name.includes("Google")),
    ) || voices[0];

  if (preferredVoice) utterance.voice = preferredVoice;

  utterance.onend = () => {
    isSpeaking = false;
    processSpeechQueue();
  };

  utterance.onerror = () => {
    isSpeaking = false;
    processSpeechQueue();
  };

  window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  speechQueue = [];
  isSpeaking = false;
}

function getAssistantThinkingLabel() {
  return settings.personality === "mica"
    ? "Mica is thinking..."
    : "Nico is thinking...";
}

function ensureTypingIndicator() {
  let indicator = document.getElementById("typingIndicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "typingIndicator";
    indicator.className = "message assistant typing";
    indicator.style.display = "none";
    indicator.innerText = getAssistantThinkingLabel();
    chatBox.appendChild(indicator);
  }
  indicator.innerText = getAssistantThinkingLabel();
}

function startTypewriterReveal(contentDiv, getLatestText, onComplete) {
  if (!contentDiv) return;

  let displayedText = "";
  let writerTimer = null;

  const renderNextCharacter = () => {
    const latestText = getLatestText() || "";

    if (latestText.length <= displayedText.length) {
      if (typeof marked !== "undefined") {
        contentDiv.innerHTML = marked.parse(latestText);
      } else {
        contentDiv.textContent = latestText;
      }
      attachCodeCopyButtons(contentDiv.closest(".message"));
      if (typeof onComplete === "function") onComplete();
      return;
    }

    displayedText = latestText.slice(0, displayedText.length + 1);
    contentDiv.textContent = displayedText;
    writerTimer = setTimeout(renderNextCharacter, 18);
  };

  writerTimer = setTimeout(renderNextCharacter, 1200);

  return () => {
    if (writerTimer) clearTimeout(writerTimer);
  };
}

function attachCodeCopyButtons(messageDiv) {
  messageDiv.querySelectorAll("pre").forEach((pre) => {
    if (pre.parentNode.classList.contains("code-container")) return;
    const container = document.createElement("div");
    container.className = "code-container";
    pre.parentNode.insertBefore(container, pre);
    container.appendChild(pre);

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-code-btn";
    copyBtn.innerText = "Copy";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(pre.innerText);
      copyBtn.innerText = "Copied!";
      setTimeout(() => (copyBtn.innerText = "Copy"), 2000);
    };
    container.appendChild(copyBtn);
  });
}

function appendMessage(role, text, attachments = []) {
  // Update state for non-empty chats
  appLayout?.classList.remove("new-chat-mode");
  appLayout?.classList.add("active-chat-mode");

  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;

  if (role === "assistant") {
    msgDiv.innerHTML = `<span class="avatar-tag">${settings.avatar}</span><div class="content">${typeof marked !== "undefined" ? marked.parse(text) : text}</div>`;
    attachCodeCopyButtons(msgDiv);
  } else {
    const content = document.createElement("div");
    content.className = "content";
    content.textContent = text;
    attachments
      .filter((attachment) => attachment.mime_type.startsWith("image/"))
      .forEach((attachment) => {
        const image = document.createElement("img");
        image.className = "message-image-preview";
        image.src = attachment.data_url;
        image.alt = attachment.name || "Attached image";
        content.appendChild(image);
      });
    msgDiv.appendChild(content);
  }

  const indicator = document.getElementById("typingIndicator");
  if (indicator) {
    chatBox.insertBefore(msgDiv, indicator);
  } else {
    chatBox.appendChild(msgDiv);
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

function clearChatBox() {
  chatBox.innerHTML = "";
  appLayout?.classList.add("new-chat-mode");
  appLayout?.classList.remove("active-chat-mode");
  ensureTypingIndicator();
}

function focusInput() {
  if (userInput) userInput.focus();
}

function startNewChat() {
  stopSpeech();
  currentConversationId = createConversationId();
  persistCurrentConversationId();
  clearChatBox();
  loadRecentConversations();
  focusInput();
}

async function switchConversation(id) {
  stopSpeech();
  currentConversationId = id;
  persistCurrentConversationId();
  document.querySelectorAll(".recent-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.conversationId === id);
  });
  clearChatBox();
  appLayout?.classList.add("conversation-loading");
  await loadMessages();
  appLayout?.classList.remove("conversation-loading");
  focusInput();
}

async function renameConversation(id, oldTitle, e) {
  e.stopPropagation();
  const newTitle = prompt("Enter new title:", oldTitle);
  if (!newTitle || newTitle.trim() === "") return;

  try {
    await apiFetch(`${apiBaseUrl}/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    loadRecentConversations();
  } catch (err) {
    console.error("Failed to rename conversation:", err);
  }
}

async function deleteConversation(id, e) {
  e.stopPropagation();
  if (!confirm("Delete this conversation?")) return;

  try {
    await apiFetch(`${apiBaseUrl}/conversations/${id}`, {
      method: "DELETE",
    });
    if (id === currentConversationId) {
      startNewChat();
    } else {
      loadRecentConversations();
    }
  } catch (err) {
    console.error("Failed to delete conversation:", err);
  }
}

async function loadRecentConversations() {
  try {
    if (!authClient) {
      const recentsList = document.getElementById("recent-chats");
      if (recentsList) recentsList.innerHTML = "";
      return;
    }

    const response = await apiFetch(`${apiBaseUrl}/conversations`);
    const conversations = await response.json();

    const recentsList = document.getElementById("recent-chats");
    if (!recentsList) return;
    recentsList.innerHTML = "";

    conversations.forEach((conv) => {
      const item = document.createElement("div");
      item.className = "recent-item";
      item.dataset.conversationId = conv.id;
      if (conv.id === currentConversationId) item.classList.add("active");

      const titleSpan = document.createElement("span");
      titleSpan.className = "recent-title";
      titleSpan.innerText = conv.title || "Untitled Chat";

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "item-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "action-icon";
      editBtn.innerText = "✏️";
      editBtn.title = "Rename";
      editBtn.onclick = (e) => renameConversation(conv.id, conv.title, e);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "action-icon";
      deleteBtn.innerText = "🗑️";
      deleteBtn.title = "Delete";
      deleteBtn.onclick = (e) => deleteConversation(conv.id, e);

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);

      item.appendChild(titleSpan);
      item.appendChild(actionsDiv);

      item.addEventListener("click", () => switchConversation(conv.id));
      recentsList.appendChild(item);
    });
  } catch (err) {
    if (err?.message !== "Sign-in required") {
      console.error("Failed to render recents:", err);
    }
  }
}

async function loadMessages() {
  const loadToken = ++conversationLoadToken;
  const conversationId = currentConversationId;
  try {
    if (!authClient) {
      clearChatBox();
      return;
    }

    const res = await apiFetch(`${apiBaseUrl}/messages/${conversationId}`);
    const data = await res.json();
    if (
      loadToken !== conversationLoadToken ||
      conversationId !== currentConversationId
    ) {
      return;
    }
    clearChatBox();
    if (Array.isArray(data)) {
      const storedAttachments = loadConversationAttachments();
      let userMessageIndex = 0;
      data.forEach((msg) => {
        const attachments =
          msg.role === "user"
            ? storedAttachments[userMessageIndex++] || []
            : [];
        appendMessage(msg.role, msg.content, attachments);
      });
    }
  } catch (err) {
    if (loadToken === conversationLoadToken) {
      if (err?.message !== "Sign-in required") {
        console.error("Failed to load messages:", err);
      }
      appLayout?.classList.remove("conversation-loading");
    }
  }
}

function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  stopSpeech();
  const indicator = document.getElementById("typingIndicator");
  if (indicator) indicator.style.display = "none";
  resetSendButton();
}

function resetSendButton() {
  if (sendBtn) {
    sendBtn.innerText = "Send";
    sendBtn.onclick = sendMessage;
  }
}

if (sendBtn) {
  sendBtn.onclick = sendMessage;
}

if (userInput) {
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

async function sendMessage() {
  const typedMessage = userInput.value.trim();
  if (!typedMessage && selectedAttachments.length === 0) return;
  const attachmentRequest = await buildMessageWithAttachments(typedMessage);
  const message = attachmentRequest.message;
  const displayMessage = attachmentRequest.displayMessage;

  if (
    message.startsWith("disable:") ||
    message.startsWith("/") ||
    message.startsWith("enable:")
  ) {
    appendMessage("user", displayMessage, attachmentRequest.attachments);
    userInput.value = "";
    clearSelectedAttachments();
    handleCommand(message);
    return;
  }

  stopSpeech();
  appendMessage("user", displayMessage, attachmentRequest.attachments);
  await saveConversationAttachments(attachmentRequest.attachments);
  userInput.value = "";
  selectedAttachments = [];
  renderAttachments();

  const indicator = document.getElementById("typingIndicator");
  if (indicator) {
    indicator.innerText = getAssistantThinkingLabel();
    indicator.style.display = "block";
    chatBox.appendChild(indicator);
  }
  chatBox.scrollTop = chatBox.scrollHeight;

  if (sendBtn) {
    sendBtn.innerText = "Stop";
    sendBtn.onclick = stopGeneration;
  }

  currentAbortController = new AbortController();

  const assistantMsgDiv = document.createElement("div");
  assistantMsgDiv.className = "message assistant";
  assistantMsgDiv.innerHTML = `<span class="avatar-tag">${settings.avatar}</span><div class="content"></div>`;
  const contentDiv = assistantMsgDiv.querySelector(".content");

  if (indicator) {
    chatBox.insertBefore(assistantMsgDiv, indicator);
  } else {
    chatBox.appendChild(assistantMsgDiv);
  }

  let accumulatedText = "";
  let sentenceBuffer = "";
  let typingStarted = false;
  let typewriterCleanup = null;
  let typingDelayTimer = null;

  try {
    const response = await apiFetch(`${apiBaseUrl}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: currentAbortController.signal,
      body: JSON.stringify({
        message: message,
        conversation_id: currentConversationId,
        attachments: attachmentRequest.attachments,
        settings,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        errorText || `Request failed with status ${response.status}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const triggerTypingFlow = () => {
      if (typingStarted) return;
      typingStarted = true;
      if (typingDelayTimer) {
        clearTimeout(typingDelayTimer);
        typingDelayTimer = null;
      }
      typewriterCleanup = startTypewriterReveal(
        contentDiv,
        () => accumulatedText,
        () => {
          if (indicator) indicator.style.display = "none";
        },
      );
    };

    typingDelayTimer = setTimeout(triggerTypingFlow, 1400);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      accumulatedText += chunk;
      sentenceBuffer += chunk;

      if (typingStarted) {
        if (indicator) indicator.style.display = "none";
      }

      chatBox.scrollTop = chatBox.scrollHeight;

      let match;
      const sentenceRegex = /([^.!?\n]+[.!?\n]+)/g;

      while ((match = sentenceRegex.exec(sentenceBuffer)) !== null) {
        const sentence = match[0];
        queueSentence(sentence);
        sentenceBuffer = sentenceBuffer.slice(match.index + sentence.length);
        sentenceRegex.lastIndex = 0;
      }
    }

    if (sentenceBuffer.trim()) {
      queueSentence(sentenceBuffer);
    }

    if (!typingStarted) {
      if (typingDelayTimer) {
        clearTimeout(typingDelayTimer);
        typingDelayTimer = null;
      }
      triggerTypingFlow();
    }

    if (settings.sound) playCompletionChime();
    loadRecentConversations();
  } catch (error) {
    if (typingDelayTimer) {
      clearTimeout(typingDelayTimer);
      typingDelayTimer = null;
    }
    if (typewriterCleanup) typewriterCleanup();
    if (indicator) indicator.style.display = "none";
    if (error.name === "AbortError") {
      contentDiv.innerHTML += " <i>[Generation stopped]</i>";
    } else {
      contentDiv.innerText = `Error: ${error.message || "Could not connect to Nico backend."}`;
    }
  } finally {
    if (typingDelayTimer) {
      clearTimeout(typingDelayTimer);
      typingDelayTimer = null;
    }
    if (typewriterCleanup) typewriterCleanup();
    if (indicator) indicator.style.display = "none";
    currentAbortController = null;
    resetSendButton();
  }
}

// Mobile Menu Toggle & Universal Pointer Handling
const menuToggle =
  document.getElementById("menu-toggle") ||
  document.querySelector(".mobile-menu-btn");
const sidebar = document.querySelector(".sidebar");
const appLayout = document.querySelector(".app-layout");

let sidebarOverlay = document.querySelector(".sidebar-overlay");
if (!sidebarOverlay) {
  sidebarOverlay = document.createElement("div");
  sidebarOverlay.className = "sidebar-overlay";
  document.body.appendChild(sidebarOverlay);
}

function setMobileSidebar(open, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!sidebar) return;

  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  sidebar.classList.toggle("mobile-open", isMobile && open);
  appLayout?.classList.toggle("sidebar-collapsed", !isMobile && !open);

  if (isMobile) {
    sidebar.style.transform = open ? "translateX(0)" : "translateX(-100%)";
  } else {
    sidebar.style.transform = open
      ? "translateX(0)"
      : "translateX(calc(-100% - 8px))";
  }

  sidebarOverlay.classList.toggle("active", isMobile && open);
  sidebarOverlay.setAttribute("aria-hidden", String(!(isMobile && open)));
  menuToggle?.setAttribute("aria-expanded", String(open));
}

function toggleMobileSidebar(e) {
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const isOpen = isMobile
    ? sidebar?.classList.contains("mobile-open")
    : !appLayout?.classList.contains("sidebar-collapsed");
  setMobileSidebar(!isOpen, e);
}

// IMPORTANT: use ONE event per control.
// The previous version used pointerdown + click + inline onclick, so one tap
// could toggle the sidebar multiple times and immediately close it again.
if (menuToggle) {
  menuToggle.addEventListener("click", toggleMobileSidebar);
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", (e) => setMobileSidebar(false, e));
}

// Unified Command Handler
function handleCommand(commandText) {
  const parts = commandText.trim().toLowerCase().split(/\s+/);
  const action = parts[0];
  const target = parts[1];
  const param = parts[2];

  const assistantMsgDiv = document.createElement("div");
  assistantMsgDiv.className = "message assistant";
  assistantMsgDiv.innerHTML = `<span class="avatar-tag">${settings.avatar}</span><div class="content"></div>`;
  const contentDiv = assistantMsgDiv.querySelector(".content");

  if (
    (action === "disable:" && target === "tts") ||
    (action === "/disable" && target === "tts")
  ) {
    ttsEnabled = false;
    stopSpeech();
    contentDiv.innerHTML = `<i>[E.V.E. Protocol: TTS module disabled. Ref: ${param || "001"}]</i>`;
  } else if (
    (action === "enable:" && target === "tts") ||
    (action === "/enable" && target === "tts")
  ) {
    ttsEnabled = true;
    contentDiv.innerHTML = `<i>[E.V.E. Protocol: TTS module enabled. Ref: ${param || "001"}]</i>`;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.resume();
      const unlockUtterance = new SpeechSynthesisUtterance("Audio active.");
      window.speechSynthesis.speak(unlockUtterance);
    }
  } else {
    contentDiv.innerHTML = `<i>[Unknown command sequence: "${commandText}"]</i>`;
  }

  chatBox.appendChild(assistantMsgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function exportChat() {
  const messages = Array.from(chatBox.querySelectorAll(".message")).map(
    (msg) => {
      const isUser = msg.classList.contains("user");
      const role = isUser ? "User" : "Nico";
      const content = msg.querySelector(".content")?.innerText || "";
      return `**${role}:**\n${content}\n`;
    },
  );

  if (messages.length === 0) return alert("No messages to export.");

  const blob = new Blob([messages.join("\n---\n\n")], {
    type: "text/markdown",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-${currentConversationId}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportChatJson() {
  const messages = Array.from(chatBox.querySelectorAll(".message")).map(
    (msg) => ({
      role: msg.classList.contains("user") ? "user" : "assistant",
      content: msg.querySelector(".content")?.innerText || "",
    }),
  );
  if (!messages.length) return alert("No messages to export.");
  downloadFile(
    `chat-${currentConversationId}.json`,
    JSON.stringify(messages, null, 2),
    "application/json",
  );
}

function playCompletionChime() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.04, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
}

function initializeSettingsPanel() {
  const panel = document.getElementById("settingsPanel");
  const button = document.getElementById("settingsBtn");
  const closeButton = document.getElementById("closeSettingsBtn");
  const controls = {
    personality: document.getElementById("personalitySetting"),
    length: document.getElementById("lengthSetting"),
    theme: document.getElementById("themeSetting"),
    mode: document.getElementById("modeSetting"),
    font: document.getElementById("fontSetting"),
    fontScale: document.getElementById("fontSizeSetting"),
    model: document.getElementById("modelSetting"),
    memory: document.getElementById("memorySetting"),
    memoryText: document.getElementById("memoryInput"),
    context: document.getElementById("contextSetting"),
    sound: document.getElementById("soundSetting"),
    avatar: document.getElementById("avatarSetting"),
  };

  Object.entries(controls).forEach(([key, control]) => {
    control.value = settings[key];
    if (control.type === "checkbox") control.checked = settings[key];
    control.addEventListener("input", () => {
      settings[key] =
        control.type === "checkbox" ? control.checked : control.value;
      if (key === "fontScale") settings.fontScale = Number(control.value);
      saveSettings();
      applySettings();
    });
  });

  const setOpen = (open) => {
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", String(!open));
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () =>
    setOpen(!panel.classList.contains("open")),
  );
  closeButton.addEventListener("click", () => setOpen(false));
  document.addEventListener("click", (event) => {
    if (
      !event.target.closest("#settingsPanel") &&
      !event.target.closest("#settingsBtn")
    )
      setOpen(false);
  });
  document
    .getElementById("exportMarkdownBtn")
    .addEventListener("click", exportChat);
  document
    .getElementById("exportJsonBtn")
    .addEventListener("click", exportChatJson);
  document.getElementById("clearContextBtn").addEventListener("click", () => {
    settings.context = false;
    controls.context.checked = false;
    saveSettings();
    clearChatBox();
  });
  applySettings();
}

function updateAuthUi(user) {
  const userName = document.getElementById("user-name");
  const welcomeName = document.getElementById("welcomeName");
  const userAvatar = document.getElementById("user-avatar");
  const userStatus = document.getElementById("user-status");
  const signInButton = document.getElementById("sign-in-btn");
  const signOutButton = document.getElementById("sign-out-btn");

  currentUser = user;
  if (!user) {
    authUiInitialized = false;
    userName.textContent = "Not signed in";
    if (welcomeName) welcomeName.textContent = "User";
    userAvatar.textContent = "?";
    userStatus.textContent = "Sign in to save chats";
    signInButton.hidden = false;
    signOutButton.hidden = true;
    currentUser = null;
    const restored = localStorage.getItem("active_chat_id");
    if (isValidConversationId(restored)) {
      currentConversationId = restored;
    } else {
      currentConversationId = createConversationId();
    }
    persistCurrentConversationId();
    if (document.getElementById("typingIndicator")) {
      document.getElementById("typingIndicator").innerText =
        getAssistantThinkingLabel();
    }
    return;
  }

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "User";
  userName.textContent = displayName;
  if (welcomeName) welcomeName.textContent = displayName;
  userAvatar.textContent = displayName.charAt(0).toUpperCase();
  userStatus.textContent = "Online";
  signInButton.hidden = true;
  signOutButton.hidden = false;

  if (!authUiInitialized) {
    const savedUserConversationId = localStorage.getItem(
      `active_chat_id:${user.id}`,
    );
    currentConversationId = isValidConversationId(savedUserConversationId)
      ? savedUserConversationId
      : createConversationId();
    authUiInitialized = true;
    clearChatBox();
  }
  persistCurrentConversationId();
  loadRecentConversations();
}

async function signInWithGoogle() {
  if (!authClient) {
    alert("Supabase authentication is not configured yet.");
    return;
  }
  const { error } = await authClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href.split("#")[0] },
  });
  if (error) alert(`Sign-in failed: ${error.message}`);
}

async function initializeAuth() {
  if (!authClient) {
    updateAuthUi(null);
    return;
  }

  authClient.auth.onAuthStateChange((_event, session) => {
    updateAuthUi(session?.user || null);
  });

  const { data, error } = await authClient.auth.getSession();
  if (error) {
    console.error("Failed to load sign-in session:", error);
    document.getElementById("user-status").textContent =
      `Sign-in error: ${error.message}`;
    return;
  }
  updateAuthUi(data.session?.user || null);
}

const newChatBtn =
  document.querySelector(".new-chat-btn") ||
  document.getElementById("newChatBtn");
if (newChatBtn) {
  newChatBtn.onclick = startNewChat;
}

document
  .getElementById("sign-in-btn")
  ?.addEventListener("click", signInWithGoogle);
document.getElementById("sign-out-btn")?.addEventListener("click", async () => {
  await authClient?.auth.signOut();
});

// Initial setup
ensureTypingIndicator();
initializeSettingsPanel();
initializeAuth();
focusInput();
