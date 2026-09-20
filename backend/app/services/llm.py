"""Single LLM gateway. Uses Groq if GROQ_API_KEY is set, otherwise Gemini
if GEMINI_API_KEY is set, otherwise returns None so callers fall back to
their honest rule-based paths. Every caller tags responses with the
`provider` returned here, so the UI always shows which model produced text.
"""
import json
import logging
import time
from typing import Optional

import requests

from ..config import GEMINI_API_KEY, GROQ_API_KEY

log = logging.getLogger("llm")

GEMINI_MODELS = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash"]
_gemini_model: Optional[str] = None
_thinking_supported: Optional[bool] = None


def provider() -> Optional[str]:
    if GROQ_API_KEY:
        return "groq"
    if GEMINI_API_KEY:
        return "gemini"
    return None


def _groq(system: str, turns: list, max_tokens: int, temperature: float, json_mode: bool) -> Optional[str]:
    messages = ([{"role": "system", "content": system}] if system else []) + turns
    body = {"model": "llama-3.3-70b-versatile", "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    resp = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
        json=body, timeout=25,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def _gemini_once(model: str, body: dict) -> requests.Response:
    # Retry transient overload / rate-limit responses with short backoff.
    for attempt in range(3):
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": GEMINI_API_KEY}, json=body, timeout=40,
        )
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            time.sleep(1.5 * (attempt + 1))
            continue
        return resp
    return resp


def _gemini(system: str, turns: list, max_tokens: int, temperature: float, json_mode: bool) -> Optional[str]:
    global _gemini_model, _thinking_supported
    contents = [{"role": "model" if t["role"] == "assistant" else "user", "parts": [{"text": t["content"]}]} for t in turns]
    # Newer Gemini models spend output budget on hidden reasoning; these are
    # short, well-specified tasks so we turn thinking off and give headroom.
    gen = {"maxOutputTokens": max(max_tokens * 4, 1024), "temperature": temperature}
    if json_mode:
        gen["responseMimeType"] = "application/json"
    body = {"contents": contents, "generationConfig": gen}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    candidates = [_gemini_model] if _gemini_model else GEMINI_MODELS
    last_err = None
    for model in candidates:
        for use_thinking_cfg in ([True, False] if _thinking_supported is not False else [False]):
            b = json.loads(json.dumps(body))
            if use_thinking_cfg:
                b["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
            resp = _gemini_once(model, b)
            if resp.status_code == 404:
                last_err = f"{model}: not available"
                break
            if resp.status_code == 400 and use_thinking_cfg:
                _thinking_supported = False
                continue
            if resp.status_code in (401, 403):
                raise RuntimeError(f"{model}: {resp.status_code} {resp.text[:200]}")
            if not resp.ok:
                last_err = f"{model}: {resp.status_code} {resp.text[:200]}"
                break
            data = resp.json()
            cand = (data.get("candidates") or [{}])[0]
            parts = cand.get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts).strip()
            if not text:
                last_err = f"{model}: empty response (finishReason={cand.get('finishReason')})"
                break
            _gemini_model = model
            if use_thinking_cfg:
                _thinking_supported = True
            return text
    raise RuntimeError(last_err or "gemini failed")


def complete(system: str, user: str, *, max_tokens: int = 500, temperature: float = 0.2,
             history: Optional[list] = None, json_mode: bool = False) -> tuple[Optional[str], str]:
    """Returns (text, provider_tag). provider_tag is 'groq' | 'gemini' |
    'fallback-no-llm-key' | 'fallback-llm-error'."""
    turns = [*(history or []), {"role": "user", "content": user}]
    p = provider()
    if p is None:
        return None, "fallback-no-llm-key"
    try:
        fn = _groq if p == "groq" else _gemini
        text = fn(system, turns, max_tokens, temperature, json_mode)
        return (text, p) if text else (None, "fallback-llm-error")
    except Exception as exc:
        log.warning("LLM call failed (%s): %s", p, exc)
        return None, "fallback-llm-error"
