import asyncio
import os
import re
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from groq import AsyncGroq
from pydantic import BaseModel
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
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


@app.get("/health")
def health_check():
  return {"status": "ok"}


class ChatRequest(BaseModel):
  message: str
  conversation_id: str


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

  past_messages = history_response.data

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
      f"Your creator profile: you were invented and developed by "
      f"{CREATOR_NAME}. The creator's hobbies are: {CREATOR_HOBBIES}. "
      "When asked who created or invented you, identify the creator as "
      f"{CREATOR_NAME}. Do not invent additional personal details."
  )

  messages_payload = [{"role": "system", "content": system_prompt}]
  for msg in past_messages:
    messages_payload.append({"role": msg["role"], "content": msg["content"]})
  messages_payload.append({"role": "user", "content": request.message})
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
      response_stream = await groq_client.chat.completions.create(
          messages=messages_payload,
          model="openai/gpt-oss-120b",
          stream=True,
      )

      full_reply = ""
      async for chunk in response_stream:
        content = chunk.choices[0].delta.content or ""
        if content:
          full_reply += content
          yield content

    if full_reply.strip():
      supabase_client.table("messages").insert({
          "role": "assistant",
          "content": full_reply,
          "conversation_id": request.conversation_id,
      }).execute()

  return StreamingResponse(generate(), media_type="text/plain")
