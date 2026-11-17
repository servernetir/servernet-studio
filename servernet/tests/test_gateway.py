# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026 ServerNet contributors
"""CPU-only contract tests. All outbound HTTP is replaced with MockTransport."""

import asyncio
import json
import re

import httpx
import pytest

from core.inference import external_provider as ep
from core.inference import providers


@pytest.fixture
def client(monkeypatch):
    # URL policy has its own upstream suite. No DNS or live service in these tests.
    monkeypatch.setattr(providers, "validate_provider_base_url", lambda url: url.rstrip("/"))
    return ep.ExternalProviderClient(
        provider_type="servernet",
        base_url=providers.get_base_url("servernet"),
        api_key="fake-customer-key",
    )


def run_http(monkeypatch, handler, action):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            monkeypatch.setattr(ep, "_client", lambda: http)
            return await action()
    return asyncio.run(run())


async def stream(client):
    return "\n".join([line async for line in client.stream_chat_completion(
        messages=[{"role": "user", "content": "سلام"}],
        model="servernet-chat", max_tokens=128, thread_id="same-thread",
    )])


def test_discoverable_registry_without_static_model_or_vendor_capabilities():
    entry = next(row for row in providers.list_available_providers() if row["provider_type"] == "servernet")
    assert entry["base_url"] == "https://servernet.cloud/v1"
    assert entry["default_models"] == []
    assert entry["supports_streaming"] is True
    assert entry["supports_studio_tools"] is False
    assert providers.provider_probes_with_chat("servernet") is False


def test_catalog_excludes_native_media_and_unknown_categories(client, monkeypatch):
    entries = [
        {"id": "chat-a", "category": "chat", "context_length": 32768},
        {"id": "embed-a", "category": "embedding"},
        {"id": "video-a", "category": "video"},
        {"id": "rerank-a", "category": "rerank"},
        {"id": "audio-a", "category": "audio"},
        {"id": "image-a", "category": "image"},
        {"id": "unknown"}, {"category": "chat"},
        {"id": 123, "category": "chat"}, {"id": " ", "category": "chat"},
    ]
    def handle(request):
        assert request.method == "GET"
        assert str(request.url) == "https://servernet.cloud/v1/models"
        assert request.headers["Authorization"] == "Bearer fake-customer-key"
        assert "Idempotency-Key" not in request.headers
        return httpx.Response(200, json={"object": "list", "data": entries})
    models = run_http(monkeypatch, handle, client.list_models)
    assert models == [entries[0]]


def test_stream_preserves_usage_and_charge_and_generates_request_keys(client, monkeypatch):
    requests = []
    # Extra headers are case-insensitive; a stale manually supplied key cannot collide.
    client.extra_headers = {"idempotency-key": "static-invalid-for-multiple-turns"}
    usage = {"id": "req-1", "choices": [], "usage": {"prompt_tokens": 5, "completion_tokens": 2},
             "servernet_charge_irt": 17}
    def handle(request):
        requests.append(request)
        body = json.loads(request.content)
        assert body["stream"] is True
        assert body["stream_options"] == {"include_usage": True}
        assert body["max_tokens"] == 128
        assert body["model"] == "servernet-chat"
        assert request.headers["Authorization"] == "Bearer fake-customer-key"
        assert len(request.headers.get_list("Idempotency-Key")) == 1
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"سلام"}}]}\n\n'
                              + "data: " + json.dumps(usage) + "\n\ndata: [DONE]\n\n",
                              headers={"Content-Type": "text/event-stream"})
    async def twice():
        return await stream(client), await stream(client)
    outputs = run_http(monkeypatch, handle, twice)
    keys = [r.headers["Idempotency-Key"] for r in requests]
    assert len(set(keys)) == 2
    assert all(re.fullmatch(r"sn-studio-[0-9a-f]{32}", key) for key in keys)
    for output in outputs:
        assert '"servernet_charge_irt": 17' in output
        assert '"prompt_tokens": 5' in output
        assert "[DONE]" in output


@pytest.mark.parametrize("status,code", [(402, "insufficient_funds"), (409, "duplicate_request"),
                                         (502, "upstream_outcome_unknown"), (429, "rate_limited")])
def test_http_failure_is_not_retried(client, monkeypatch, status, code):
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"code": code, "message": code}},
                              headers={"x-should-retry": "false"})
    output = run_http(monkeypatch, handle, lambda: stream(client))
    assert len(calls) == 1
    assert code in output


@pytest.mark.parametrize("streaming", [True, False])
def test_compatibility_error_does_not_resend_changed_body(client, monkeypatch, streaming):
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(400, json={"error": {"param": "max_tokens", "code": "unsupported_parameter",
                              "message": "Use max_completion_tokens instead of max_tokens"}})
    async def action():
        if streaming:
            return await stream(client)
        with pytest.raises(httpx.HTTPStatusError):
            await client.chat_completion(messages=[{"role": "user", "content": "hi"}],
                                         model="servernet-chat", max_tokens=128)
    run_http(monkeypatch, handle, action)
    assert len(calls) == 1
    assert "Idempotency-Key" in calls[0].headers


def test_timeout_does_not_resend_paid_completion(client, monkeypatch):
    calls = []
    def handle(request):
        calls.append(request)
        raise httpx.ReadTimeout("synthetic timeout", request=request)
    output = run_http(monkeypatch, handle, lambda: stream(client))
    assert len(calls) == 1
    assert "error" in output


def test_nonstream_uses_gateway_wallet_contract(client, monkeypatch):
    def handle(request):
        body = json.loads(request.content)
        assert body["stream"] is False
        assert "stream_options" not in body
        assert re.fullmatch(r"sn-studio-[0-9a-f]{32}", request.headers["Idempotency-Key"])
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "ok"}}],
                                       "servernet_charge_irt": 9})
    result = run_http(monkeypatch, handle, lambda: client.chat_completion(
        messages=[{"role": "user", "content": "hi"}], model="servernet-chat", max_tokens=64))
    assert result["servernet_charge_irt"] == 9


def test_other_providers_keep_compatibility_fallbacks(monkeypatch):
    bodies = []
    def handle(request):
        body = json.loads(request.content)
        bodies.append(body)
        if "max_tokens" in body:
            return httpx.Response(400, json={"error": {"param": "max_tokens", "code": "unsupported_parameter",
                                          "message": "Use max_completion_tokens"}})
        return httpx.Response(200, text="data: [DONE]\n\n")
    async def action():
        async with ep._stream_post_with_compat_fallbacks(ep._client(), "https://example.test/v1/chat/completions",
                                                        {"max_tokens": 32}) as response:
            assert response.status_code == 200
    run_http(monkeypatch, handle, action)
    assert bodies == [{"max_tokens": 32}, {"max_completion_tokens": 32}]
