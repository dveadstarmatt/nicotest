const chatBox = document.getElementById("chatBox");
const micBtn = document.getElementById("micBtn");
const userInput = document.getElementById("userInput");
const sendBtn = document.querySelector(".send-btn");

let currentConversationId =
  localStorage.getItem("active_chat_id") || crypto.randomUUID();
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

/* Event-driven TTS Queueing */
function queueSentence(text) {
  if (!ttsEnabled || !("speechSynthesis" in window)) return;

  const cleanText = text
    .replace(/<[^>]*>/g, "")
    .replace(/```[\s\S]*?```/g, "")
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
  currentConversationId = crypto.randomUUID();
  localStorage.setItem("active_chat_id", currentConversationId);
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
    await fetch(`http://127.0.0.1:8000/conversations/${id}`, {
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
    await fetch(`http://127.0.0.1:8000/conversations/${id}`, {
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
    const response = await fetch("http://127.0.0.1:8000/conversations");
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
    const res = await fetch(
      `http://127.0.0.1:8000/messages/${currentConversationId}`,
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
    const response = await fetch("http://127.0.0.1:8000/chat/stream", {
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

// Mobile Menu Toggle & Backdrop Overlay Setup (handles both ID and class selectors)
const menuToggle =
  document.getElementById("menu-toggle") ||
  document.querySelector(".mobile-menu-btn");
const sidebar = document.querySelector(".sidebar");

let sidebarOverlay = document.querySelector(".sidebar-overlay");
if (!sidebarOverlay) {
  sidebarOverlay = document.createElement("div");
  sidebarOverlay.className = "sidebar-overlay";
  document.body.appendChild(sidebarOverlay);
}

function toggleMobileSidebar(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (sidebar) {
    sidebar.classList.toggle("mobile-open");
    sidebarOverlay.classList.toggle("active");
  }
}

if (menuToggle) {
  menuToggle.addEventListener("click", toggleMobileSidebar);
  menuToggle.addEventListener("touchend", toggleMobileSidebar, {
    passive: false,
  });
}

sidebarOverlay.addEventListener("click", toggleMobileSidebar);
sidebarOverlay.addEventListener("touchend", toggleMobileSidebar, {
  passive: false,
});

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

  const blob = new Blob([messages.join("\n--อน--\n\n")], {
    type: "text/markdown",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-${currentConversationId}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

const newChatBtn =
  document.querySelector(".new-chat-btn") ||
  document.getElementById("newChatBtn");
if (newChatBtn) {
  newChatBtn.onclick = startNewChat;
}

// Initial setup
ensureTypingIndicator();
loadMessages();
loadRecentConversations();
focusInput();
