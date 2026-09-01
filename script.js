const chatBox = document.getElementById("chatBox");
const micBtn = document.getElementById("micBtn");
const userInput = document.getElementById("userInput");
const sendBtn = document.querySelector(".send-btn");
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

function ensureTypingIndicator() {
  let indicator = document.getElementById("typingIndicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "typingIndicator";
    indicator.className = "message assistant typing";
    indicator.style.display = "none";
    indicator.innerText = "Nico is thinking...";
    chatBox.appendChild(indicator);
  }
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

function appendMessage(role, text) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;

  if (role === "assistant") {
    msgDiv.innerHTML = `<span class="avatar-tag">✦</span><div class="content">${typeof marked !== "undefined" ? marked.parse(text) : text}</div>`;
    attachCodeCopyButtons(msgDiv);
  } else {
    msgDiv.innerHTML = `<div class="content">${text}</div>`;
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
  ensureTypingIndicator();
}

function focusInput() {
  if (userInput) userInput.focus();
}

function startNewChat() {
  stopSpeech();
  currentConversationId = createConversationId();
  localStorage.setItem(conversationStorageKey(), currentConversationId);
  clearChatBox();
  loadRecentConversations();
  focusInput();
}

async function switchConversation(id) {
  stopSpeech();
  currentConversationId = id;
  localStorage.setItem("active_chat_id", currentConversationId);
  clearChatBox();
  await loadMessages();
  loadRecentConversations();
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
    const response = await apiFetch(`${apiBaseUrl}/conversations`);
    const conversations = await response.json();

    const recentsList = document.getElementById("recent-chats");
    if (!recentsList) return;
    recentsList.innerHTML = "";

    conversations.forEach((conv) => {
      const item = document.createElement("div");
      item.className = "recent-item";
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
    console.error("Failed to render recents:", err);
  }
}

async function loadMessages() {
  try {
    const res = await apiFetch(
      `${apiBaseUrl}/messages/${currentConversationId}`,
    );
    const data = await res.json();
    clearChatBox();
    if (Array.isArray(data)) {
      data.forEach((msg) => appendMessage(msg.role, msg.content));
    }
  } catch (err) {
    console.error("Failed to load messages:", err);
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
  const message = userInput.value.trim();
  if (!message) return;

  if (
    message.startsWith("disable:") ||
    message.startsWith("/") ||
    message.startsWith("enable:")
  ) {
    appendMessage("user", message);
    userInput.value = "";
    handleCommand(message);
    return;
  }

  stopSpeech();
  appendMessage("user", message);
  userInput.value = "";

  const indicator = document.getElementById("typingIndicator");
  if (indicator) {
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
  assistantMsgDiv.innerHTML = `<span class="avatar-tag">✦</span><div class="content"></div>`;
  const contentDiv = assistantMsgDiv.querySelector(".content");

  if (indicator) {
    chatBox.insertBefore(assistantMsgDiv, indicator);
  } else {
    chatBox.appendChild(assistantMsgDiv);
  }

  let accumulatedText = "";
  let sentenceBuffer = "";

  try {
    const response = await apiFetch(`${apiBaseUrl}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: currentAbortController.signal,
      body: JSON.stringify({
        message: message,
        conversation_id: currentConversationId,
      }),
    });

    if (indicator) indicator.style.display = "none";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      accumulatedText += chunk;
      sentenceBuffer += chunk;

      contentDiv.innerHTML =
        typeof marked !== "undefined"
          ? marked.parse(accumulatedText)
          : accumulatedText;
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

    attachCodeCopyButtons(assistantMsgDiv);
    loadRecentConversations();
  } catch (error) {
    if (indicator) indicator.style.display = "none";
    if (error.name === "AbortError") {
      contentDiv.innerHTML += " <i>[Generation stopped]</i>";
    } else {
      contentDiv.innerText = "Error: Could not connect to Nico backend.";
    }
  } finally {
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
  sidebarOverlay.classList.toggle("active", isMobile && open);
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
  assistantMsgDiv.innerHTML = `<span class="avatar-tag">✦</span><div class="content"></div>`;
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

function updateAuthUi(user) {
  const userName = document.getElementById("user-name");
  const userAvatar = document.getElementById("user-avatar");
  const userStatus = document.getElementById("user-status");
  const signInButton = document.getElementById("sign-in-btn");
  const signOutButton = document.getElementById("sign-out-btn");

  currentUser = user;
  if (!user) {
    userName.textContent = "Not signed in";
    userAvatar.textContent = "?";
    userStatus.textContent = "Sign in to save chats";
    signInButton.hidden = false;
    signOutButton.hidden = true;
    clearChatBox();
    return;
  }

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "User";
  userName.textContent = displayName;
  userAvatar.textContent = displayName.charAt(0).toUpperCase();
  userStatus.textContent = "Online";
  signInButton.hidden = true;
  signOutButton.hidden = false;

  const savedId = localStorage.getItem(`active_chat_id:${user.id}`);
  currentConversationId = isValidConversationId(savedId)
    ? savedId
    : createConversationId();
  localStorage.setItem(`active_chat_id:${user.id}`, currentConversationId);
  loadMessages();
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
initializeAuth();
focusInput();
