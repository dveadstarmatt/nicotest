import asyncio
import base64
import io
import os
import re
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from groq import AsyncGroq
from google import genai
from google.genai import types
from pydantic import BaseModel
from pypdf import PdfReader
from docx import Document
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", "gemini-3.1-flash-lite")
configured_vision_models = [
  model.strip()
  for model in os.getenv("GROQ_VISION_MODELS", "").split(",")
  if model.strip()
]
GROQ_VISION_MODELS = list(dict.fromkeys(
  configured_vision_models + [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3-vl-32b-instruct",
  ]
))
CREATOR_NAME = os.getenv("CREATOR_NAME", "Matt Andrei Crisostomo")
CREATOR_HOBBIES = os.getenv("CREATOR_HOBBIES", "Not provided")

if not SUPABASE_URL or not SUPABASE_KEY or not GROQ_API_KEY:
  raise ValueError("Missing required environment variables in .env file.")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (or specify ["http://127.0.0.1:5500"])
  allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
groq_client = AsyncGroq(api_key=GROQ_API_KEY)
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


@app.get("/health")
def health_check():
  return {"status": "ok"}


class ChatRequest(BaseModel):
  message: str
  conversation_id: str
  attachments: list[dict] = []
  settings: dict = {}


class RenameRequest(BaseModel):
  title: str


def get_current_user(authorization: str | None):
  if not authorization or not authorization.startswith("Bearer "):
    raise HTTPException(status_code=401, detail="Sign-in required")

  try:
    response = supabase_client.auth.get_user(authorization.removeprefix("Bearer ").strip())
    if not response.user:
      raise HTTPException(status_code=401, detail="Invalid sign-in session")
    return response.user
  except HTTPException:
    raise
  except Exception as error:
    raise HTTPException(status_code=401, detail="Invalid sign-in session") from error


def get_owned_conversation(conversation_id: str, user_id: str):
  response = (
      supabase_client.table("conversations")
      .select("id")
      .eq("id", conversation_id)
      .eq("user_id", user_id)
      .execute()
  )
  if not response.data:
    raise HTTPException(status_code=404, detail="Conversation not found")
  return response.data[0]


def creator_reply(message: str):
  normalized_message = message.lower()
  asks_about_creator = (
      re.search(r"who\s+(?:invent\w*|creat\w*|develop\w*|made)\s+(?:you|nico)", normalized_message)
      or "who invented nico" in normalized_message
      or "who created nico" in normalized_message
      or "who is matt andrei crisostomo" in normalized_message
  )
  if not asks_about_creator:
    return None

  if "who is matt andrei crisostomo" in normalized_message:
    return f"Matt Andrei Crisostomo is Nico's creator. His hobbies are {CREATOR_HOBBIES}."
  return f"Nico AI was invented and developed by {CREATOR_NAME}."


def account_name(user):
  return (
      user.user_metadata.get("full_name")
      or user.user_metadata.get("name")
      or (user.email or "").split("@")[0]
      or "User"
  )


def attachment_text(attachment):
  data_url = attachment.get("data_url", "")
  if "," not in data_url:
    return f"[Could not read {attachment.get('name', 'attachment')}]"

  try:
    raw_data = base64.b64decode(data_url.split(",", 1)[1])
    mime_type = attachment.get("mime_type", "")
    name = attachment.get("name", "attachment")
    if mime_type == "application/pdf" or name.lower().endswith(".pdf"):
      reader = PdfReader(io.BytesIO(raw_data))
      text = "\n".join(page.extract_text() or "" for page in reader.pages)
      return f"Attached file: {name}\n{text[:12000]}"
    if name.lower().endswith(".docx"):
      document = Document(io.BytesIO(raw_data))
      text = "\n".join(paragraph.text for paragraph in document.paragraphs)
      return f"Attached file: {name}\n{text[:12000]}"
    return f"[Binary file not text-readable: {name}]"
  except Exception:
    return f"[Could not read {attachment.get('name', 'attachment')}]"


def build_user_content(message, attachments):
  image_parts = [
      {
          "type": "image_url",
          "image_url": {"url": attachment["data_url"]},
      }
      for attachment in attachments
      if attachment.get("mime_type", "").startswith("image/")
      and attachment.get("data_url")
  ]
  file_context = [
      attachment_text(attachment)
      for attachment in attachments
      if not attachment.get("mime_type", "").startswith("image/")
  ]
  full_text = "\n\n".join([message, *file_context]).strip()
  if not image_parts:
    return full_text
  return [{"type": "text", "text": full_text or "Describe this image."}, *image_parts]


async def generate_gemini_image_response(message, attachments, system_prompt):
  if not gemini_client:
    return (
      "Image analysis is not configured yet. Add GEMINI_API_KEY to the "
      "Render backend environment and redeploy."
    )

  parts = [types.Part.from_text(text=message or "Describe this image.")]
  for attachment in attachments:
    if not attachment.get("mime_type", "").startswith("image/"):
      continue
    data_url = attachment.get("data_url", "")
    if "," not in data_url:
      continue
    parts.append(
      types.Part.from_bytes(
        data=base64.b64decode(data_url.split(",", 1)[1]),
        mime_type=attachment.get("mime_type", "image/jpeg"),
      )
    )

  response = await asyncio.to_thread(
    gemini_client.models.generate_content,
    model=GEMINI_VISION_MODEL,
    contents=parts,
    config=types.GenerateContentConfig(system_instruction=system_prompt),
  )
  return response.text or "Gemini returned an empty image analysis."


@app.get("/conversations")
def get_conversations(authorization: str | None = Header(default=None)):
  user = get_current_user(authorization)
  response = (
      supabase_client.table("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", desc=True)
      .execute()
  )
  return response.data


# Rename conversation title
@app.patch("/conversations/{conversation_id}")
def rename_conversation(
    conversation_id: str,
    request: RenameRequest,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  get_owned_conversation(conversation_id, user.id)
  supabase_client.table("conversations").update(
      {"title": request.title}
  ).eq("id", conversation_id).execute()
  return {"status": "success"}


# Delete conversation and associated messages
@app.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  get_owned_conversation(conversation_id, user.id)
  supabase_client.table("messages").delete().eq(
      "conversation_id", conversation_id
  ).execute()
  supabase_client.table("conversations").delete().eq(
      "id", conversation_id
  ).execute()
  return {"status": "success"}


@app.get("/messages/{conversation_id}")
def get_messages(
    conversation_id: str,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  get_owned_conversation(conversation_id, user.id)
  response = (
      supabase_client.table("messages")
      .select("role, content")
      .eq("conversation_id", conversation_id)
      .order("created_at")
      .execute()
  )
  return response.data


@app.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  conv_check = (
      supabase_client.table("conversations")
      .select("id")
      .eq("id", request.conversation_id)
      .eq("user_id", user.id)
      .execute()
  )

  if not conv_check.data:
    title_prompt = (
        "Summarize this query into a 3 to 5 word title. Do not use quotes or"
        f" punctuation: '{request.message}'"
    )
    title_res = await groq_client.chat.completions.create(
        messages=[{"role": "user", "content": title_prompt}],
      model="openai/gpt-oss-120b",
    )
    generated_title = title_res.choices[0].message.content.strip()

    supabase_client.table("conversations").insert({
        "id": request.conversation_id,
        "title": generated_title,
      "user_id": user.id,
    }).execute()

  history_response = (
      supabase_client.table("messages")
      .select("role, content")
      .eq("conversation_id", request.conversation_id)
      .order("created_at")
      .execute()
  )

  past_messages = history_response.data if request.settings.get("context", True) else []

  supabase_client.table("messages").insert({
      "role": "user",
      "content": request.message,
      "conversation_id": request.conversation_id,
  }).execute()

  system_prompt = (
      "You are Nico, an advanced AI system assistant. "
      "Your responses should be sharp, concise, direct, and helpful. "
      "Answer the user's latest message directly. Do not send a generic "
      "greeting unless the user is actually greeting you. "
      "Important: never invent people, roles, or descriptions. "
      "For tables, character profiles, or bios, use only verified facts from the "
      "specific source or context the user provides. Do not make up names, "
      "descriptions, or relationships. If you are unsure, say you cannot verify "
      "the data and provide only confirmed facts. "
      f"Your creator profile: you were invented and developed by "
      f"{CREATOR_NAME}. The creator's hobbies are: {CREATOR_HOBBIES}. "
      "When asked who created or invented you, identify the creator as "
      f"{CREATOR_NAME}. Do not invent additional personal details."
  )
  personality = request.settings.get("personality", "professional")
  response_length = request.settings.get("length", "short")
  memory = request.settings.get("memoryText", "") if request.settings.get("memory", True) else ""
  system_prompt += (
    f" Use a {personality} conversational tone."
    f" Prefer {response_length} responses."
    + (f" User preferences to remember: {memory}." if memory else "")
  )

  messages_payload = [{"role": "system", "content": system_prompt}]
  for msg in past_messages:
    messages_payload.append({"role": msg["role"], "content": msg["content"]})
  user_content = build_user_content(request.message, request.attachments)
  messages_payload.append({"role": "user", "content": user_content})
  fixed_creator_reply = creator_reply(request.message)
  user_name = account_name(user)
  asks_for_name = bool(
      re.search(r"\bwhat(?:'s| is) my name\b", request.message.lower())
  )

  async def generate():
    if fixed_creator_reply:
      full_reply = fixed_creator_reply
      yield full_reply
    elif asks_for_name:
      full_reply = f"Your name is {user_name}."
      yield full_reply
    else:
      full_reply = ""
      image_request = any(
        attachment.get("mime_type", "").startswith("image/")
        for attachment in request.attachments
      )
      if image_request:
        try:
          full_reply = await generate_gemini_image_response(
            request.message, request.attachments, system_prompt
          )
        except Exception as error:
          full_reply = f"Nico could not analyze that image. Gemini error: {error}"
        yield full_reply
        models_to_try = []
      else:
        models_to_try = [
          "openai/gpt-oss-20b"
          if request.settings.get("model") == "light"
          else "openai/gpt-oss-120b"
        ]
      last_error = None

      for model in models_to_try:
        try:
          response_stream = await groq_client.chat.completions.create(
              messages=messages_payload,
              model=model,
              stream=True,
          )

          async for chunk in response_stream:
            content = chunk.choices[0].delta.content or ""
            if content:
              full_reply += content
              yield content
          break
        except Exception as error:
          last_error = error
          error_text = str(error).lower()
          model_unavailable = any(
            code in error_text
            for code in (
              "model_not_found",
              "model_decommissioned",
              "model_deprecated",
            )
          )
          if not image_request or not model_unavailable:
            break

      if not full_reply and last_error:
        if image_request and any(
          code in str(last_error).lower()
          for code in ("model_not_found", "model_decommissioned", "model_deprecated")
        ):
          full_reply = (
            "Nico could not analyze this image because the Groq account has no "
            "access to an enabled vision model. Set GROQ_VISION_MODELS in the "
            "Render backend environment to a vision model available to your key."
          )
        else:
          full_reply = f"Nico could not analyze that request right now. Backend error: {last_error}"
        yield full_reply

    if full_reply.strip():
      supabase_client.table("messages").insert({
          "role": "assistant",
          "content": full_reply,
          "conversation_id": request.conversation_id,
      }).execute()

  return StreamingResponse(generate(), media_type="text/plain")