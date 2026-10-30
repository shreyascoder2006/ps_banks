"""Thin streaming client for a local Ollama server (/api/chat).

Yields parsed JSON chunks so the agent can forward tokens to the browser as
they arrive and still collect tool calls the model emits mid-stream.
"""
import json
from typing import Iterator, Optional

import requests

from ...config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_NUM_CTX


def is_available() -> bool:
    try:
        return requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2).ok
    except requests.RequestException:
        return False


def installed_models() -> list[str]:
    try:
        r = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]
    except requests.RequestException:
        return []


def stream_chat(messages: list, tools: Optional[list] = None, temperature: float = 0.2,
                num_predict: int = 700) -> Iterator[dict]:
    body = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": True,
        "keep_alive": "30m",
        "options": {"temperature": temperature, "num_ctx": OLLAMA_NUM_CTX, "num_predict": num_predict},
    }
    if tools:
        body["tools"] = tools
    with requests.post(f"{OLLAMA_BASE_URL}/api/chat", json=body, stream=True, timeout=(5, 300)) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if line:
                yield json.loads(line)
