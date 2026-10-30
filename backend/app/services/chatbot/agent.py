"""Chat agent: retrieval-augmented prompt + tool-calling loop over Ollama.

`run_chat` is a generator of event dicts (status / token / done / error) that
the route serialises as server-sent events.
"""
import json
import logging
from typing import Iterator

from ...config import OLLAMA_MODEL
from . import ollama_client
from .knowledge import retrieve
from .tools import REGISTRY, run_tool, select_tools

log = logging.getLogger("chatbot")

MAX_TOOL_ROUNDS = 2
MAX_HISTORY = 8

SYSTEM = """You are Bank Pulse Assistant, the built-in AI for the Bank Pulse customer intelligence and retention console used by Indian bank branch staff.
You can answer anything about this project: its pages, features, churn model, segments, outreach rules, complaints, RBI policy, data, code, API and limitations. You may also answer general questions.

Rules:
- For any question about live numbers, customers, complaints, segments, branches, forecasts or model quality, CALL A TOOL. Never invent figures, customer ids or names.
- For how-things-work questions, use the CONTEXT excerpts below. If the context does not contain the answer, say so plainly instead of guessing.
- When you answer from general knowledge rather than project data or tools, start with "(General knowledge)".
- Be concise: short paragraphs or bullets, plain language. Use the Rs symbol for currency. Never say "tool", "function call", "response" or "JSON" - just state the facts directly, e.g. "1,347 customers are at critical risk".
- Never reveal secrets or API keys. You are read-only: you can recommend outreach but cannot send it or change data; tell the user which page to use for that.
- For unauthorized transactions mention RBI zero-liability; for complaints mention the 30-day resolution mandate when relevant.

CONTEXT:
{context}"""


def _context_block(query: str):
    chunks = retrieve(query, k=3)
    if not chunks:
        return "(no relevant excerpts found)", []
    text = "\n\n".join(f"[{c.source}]\n{c.text[:850]}" for c in chunks)
    sources = []
    for c in chunks:
        if c.source not in sources:
            sources.append(c.source)
    return text, sources


def _trim(history: list) -> list:
    out = [{"role": m["role"], "content": m["content"][:2000]} for m in (history or [])
           if m.get("role") in ("user", "assistant") and m.get("content")]
    return out[-MAX_HISTORY:]


def run_chat(question: str, history: list) -> Iterator[dict]:
    if not ollama_client.is_available():
        yield {"type": "error", "text": "Ollama is not running. Start it with `ollama serve` and make sure the model is pulled: `ollama pull " + OLLAMA_MODEL + "`."}
        return
    if OLLAMA_MODEL not in ollama_client.installed_models():
        yield {"type": "error", "text": f"Model {OLLAMA_MODEL} is not installed. Run `ollama pull {OLLAMA_MODEL}`."}
        return

    yield {"type": "status", "text": "Searching project knowledge..."}
    context, sources = _context_block(question)
    messages = [{"role": "system", "content": SYSTEM.format(context=context)}, *_trim(history),
                {"role": "user", "content": question}]
    tools_used: list[str] = []
    tool_specs = select_tools(question)

    try:
        for round_no in range(MAX_TOOL_ROUNDS + 1):
            tool_calls, produced = [], False
            use_tools = tool_specs if (tool_specs and round_no < MAX_TOOL_ROUNDS) else None
            if round_no:
                yield {"type": "status", "text": "Writing answer..."}
            content_parts = []
            for chunk in ollama_client.stream_chat(messages, tools=use_tools):
                msg = chunk.get("message", {})
                if msg.get("tool_calls"):
                    tool_calls.extend(msg["tool_calls"])
                if msg.get("content"):
                    produced = True
                    content_parts.append(msg["content"])
                    yield {"type": "token", "text": msg["content"]}
            if not tool_calls:
                if not produced:
                    yield {"type": "token", "text": "I couldn't produce an answer for that. Try rephrasing."}
                break
            messages.append({"role": "assistant", "content": "".join(content_parts), "tool_calls": tool_calls})
            for call in tool_calls:
                fn = call.get("function", {})
                name, args = fn.get("name", ""), fn.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                yield {"type": "status", "text": f"Looking up live data: {name.replace('_', ' ')}..."}
                tools_used.append(name)
                messages.append({"role": "tool", "name": name, "content": run_tool(name, args)})
    except Exception as exc:
        log.exception("chat failed")
        yield {"type": "error", "text": f"Chat failed: {exc}"}
        return

    yield {"type": "done", "sources": sources, "tools": list(dict.fromkeys(tools_used)), "model": OLLAMA_MODEL,
           "toolCount": len(REGISTRY)}
