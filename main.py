import asyncio
import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from groq import AsyncGroq
from pydantic import BaseModel
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

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

supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
groq_client = AsyncGroq(api_key=GROQ_API_KEY)


@app.get("/health")
def health_check():
  return {"status": "ok"}


class ChatRequest(BaseModel):
  message: str
  conversation_id: str


class RenameRequest(BaseModel):
  title: str


@app.get("/conversations")
def get_conversations():
  response = (
      supabase_client.table("conversations")
      .select("*")
      .order("created_at", desc=True)
      .execute()
  )
  return response.data


# Rename conversation title
@app.patch("/conversations/{conversation_id}")
def rename_conversation(conversation_id: str, request: RenameRequest):
  supabase_client.table("conversations").update(
      {"title": request.title}
  ).eq("id", conversation_id).execute()
  return {"status": "success"}


# Delete conversation and associated messages
@app.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str):
  supabase_client.table("messages").delete().eq(
      "conversation_id", conversation_id
  ).execute()
  supabase_client.table("conversations").delete().eq(
      "id", conversation_id
  ).execute()
  return {"status": "success"}


@app.get("/messages/{conversation_id}")
def get_messages(conversation_id: str):
  response = (
      supabase_client.table("messages")
      .select("role, content")
      .eq("conversation_id", conversation_id)
      .order("created_at")
      .execute()
  )
  return response.data


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
  conv_check = (
      supabase_client.table("conversations")
      .select("id")
      .eq("id", request.conversation_id)
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
      "greeting unless the user is actually greeting you."
  )

  messages_payload = [{"role": "system", "content": system_prompt}]
  for msg in past_messages:
    messages_payload.append({"role": msg["role"], "content": msg["content"]})
  messages_payload.append({"role": "user", "content": request.message})

  async def generate():
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