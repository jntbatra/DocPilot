"""Swappable LLM client interface used by the reranking judge and generation.

Provider is picked at runtime via LLM_PROVIDER (or passed explicitly) so the
judge stage can run on Bedrock, on Amazon Bedrock Mantle (AWS's own
OpenAI-compatible endpoint), or fall back to a deterministic stub for offline
tests.

Bedrock Mantle notes (docs: Amazon Bedrock User Guide → Responses API):
  base URL   https://bedrock-mantle.<region>.api.aws/openai/v1
  auth       a long-term *Bedrock API key*, passed as OPENAI_API_KEY
  models     google.gemma-4-31b and friends are mantle-ONLY — they are not
             served on bedrock-runtime at all
  regions    us-east-1, us-east-2, us-west-2, eu-central-1 (for gemma-4-31b)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

from dotenv import load_dotenv

load_dotenv()


class LLMClient(Protocol):
    def generate(self, prompt: str, **kwargs) -> str:
        """Return model text for a prompt."""


@dataclass(slots=True)
class StubLLMClient:
    """Deterministic fallback used when no provider/credentials are configured."""

    response: str | None = None

    def generate(self, prompt: str, **kwargs) -> str:
        if self.response is not None:
            return self.response
        return "Verdict: <<ACCEPT>> Reason: stub client, no judgement performed."


@dataclass(slots=True)
class BedrockLLMClient:
    """Amazon Bedrock client using the Converse API.

    Model is chosen by the caller (arg or BEDROCK_MODEL_ID env var). Credentials
    resolve via the normal boto3 chain (env vars, ~/.aws/credentials, instance role).
    """

    model_id: str = field(default_factory=lambda: os.environ.get("BEDROCK_MODEL_ID", ""))
    region: str = field(default_factory=lambda: os.environ.get("AWS_REGION", "us-east-1"))
    _client: Any = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        if not self.model_id:
            raise ValueError(
                "model_id required (pass it or set BEDROCK_MODEL_ID), e.g. "
                "'us.anthropic.claude-sonnet-4-6-v1:0'"
            )
        import boto3  # imported lazily so stub-only runs need no AWS deps

        self._client = boto3.client("bedrock-runtime", region_name=self.region)

    def generate(self, prompt: str, **kwargs) -> str:
        inference_config: dict[str, Any] = {}
        if "max_tokens" in kwargs:
            inference_config["maxTokens"] = kwargs["max_tokens"]
        if "temperature" in kwargs:
            inference_config["temperature"] = kwargs["temperature"]

        resp = self._client.converse(
            modelId=self.model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig=inference_config or {"maxTokens": 512},
        )
        return resp["output"]["message"]["content"][0]["text"]


# Amazon Bedrock Mantle — AWS's OpenAI-compatible endpoint.
# Gemma 4 31B is served at /openai/v1 on mantle, not the default /v1.
MANTLE_URL = "https://bedrock-mantle.{region}.api.aws/openai/v1"
DEFAULT_MANTLE_MODEL = "google.gemma-4-31b"   # 256K context, reasoning, tool calls


def mantle_base_url(region: str | None = None) -> str:
    """Region-specific Mantle base URL. Explicit OPENAI_BASE_URL always wins."""
    explicit = os.environ.get("OPENAI_BASE_URL")
    if explicit:
        return explicit
    region = region or os.environ.get("AWS_REGION", "us-east-1")
    return MANTLE_URL.format(region=region)


@dataclass(slots=True)
class MantleSigV4LLMClient:
    """Bedrock Mantle using ordinary AWS credentials instead of an API key.

    The OpenAI SDK can only send a bearer token, but Mantle also accepts plain
    SigV4-signed HTTP. That means `aws configure` credentials (or an instance
    role) work with no API key to manage — which is usually what you want on a
    dev box or in CI.
    """

    model: str = field(default_factory=lambda: os.environ.get(
        "BEDROCK_MANTLE_MODEL", "google.gemma-4-31b"))
    region: str = field(default_factory=lambda: os.environ.get("AWS_REGION", "us-east-1"))
    max_tokens: int = 2048
    _session: Any = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        import boto3
        self._session = boto3.Session()
        if self._session.get_credentials() is None:
            raise ValueError(
                "no AWS credentials found — run `aws configure`, or set "
                "LLM_PROVIDER=bedrock_mantle with OPENAI_API_KEY for key auth"
            )

    @property
    def endpoint(self) -> str:
        return f"https://bedrock-mantle.{self.region}.api.aws/openai/v1/chat/completions"

    def generate(self, prompt: str, **kwargs) -> str:
        import json as _json
        import urllib.error
        import urllib.request

        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest

        body = _json.dumps({
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
            "temperature": kwargs.get("temperature", 0.0),
        })

        creds = self._session.get_credentials().get_frozen_credentials()
        signed = AWSRequest(method="POST", url=self.endpoint, data=body,
                            headers={"Content-Type": "application/json"})
        SigV4Auth(creds, "bedrock", self.region).add_auth(signed)

        req = urllib.request.Request(self.endpoint, data=body.encode(),
                                     headers=dict(signed.headers), method="POST")
        try:
            with urllib.request.urlopen(req, timeout=kwargs.get("timeout", 90)) as resp:
                data = _json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Mantle {e.code}: {e.read().decode()[:300]}") from e

        return data["choices"][0]["message"]["content"] or ""


@dataclass(slots=True)
class OpenAICompatibleLLMClient:
    """One client for any OpenAI Chat-Completions compatible endpoint.

    Covers the Bedrock Mantle gateway as well as local servers / OpenAI direct —
    they differ only by base_url + model + api_key.
    """

    model: str
    base_url: str | None = None
    api_key: str = "EMPTY"
    max_tokens: int = 512
    _client: Any = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        from openai import OpenAI  # lazy import so stub/bedrock runs need no openai dep

        self._client = OpenAI(api_key=self.api_key, base_url=self.base_url)

    def generate(self, prompt: str, **kwargs) -> str:
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=kwargs.get("max_tokens", self.max_tokens),
            temperature=kwargs.get("temperature", 0.0),
        )
        return resp.choices[0].message.content or ""


def make_llm_client(provider: str | None = None, *, model: str | None = None, **kwargs) -> LLMClient:
    """Factory: pick an LLM backend by name (or LLM_PROVIDER env var).

    provider:
      stub            -> deterministic StubLLMClient (no network)
      mantle_aws      -> Bedrock Mantle signed with your AWS credentials (default).
                         No API key needed; model defaults to google.gemma-4-31b.
      bedrock         -> BedrockLLMClient, native boto3 Converse API (BEDROCK_MODEL_ID, AWS creds)
      bedrock_mantle  -> Amazon Bedrock Mantle, AWS's OpenAI-compatible endpoint.
                         Base URL is derived from AWS_REGION unless OPENAI_BASE_URL
                         is set. Model defaults to google.gemma-4-31b.
                         Needs a Bedrock API key in OPENAI_API_KEY.
    """
    provider = (provider or os.environ.get("LLM_PROVIDER", "mantle_aws")).lower()

    if provider == "stub":
        return StubLLMClient()
    if provider in ("mantle_aws", "bedrock_mantle_aws"):
        # Mantle over SigV4 — uses `aws configure` credentials, no API key.
        return MantleSigV4LLMClient(model=model or os.environ.get(
            "BEDROCK_MANTLE_MODEL", DEFAULT_MANTLE_MODEL))
    if provider == "bedrock":
        return BedrockLLMClient(model_id=model or os.environ.get("BEDROCK_MODEL_ID", ""))
    if provider == "bedrock_mantle":
        base_url = kwargs.pop("base_url", None) or mantle_base_url()
        api_key = kwargs.pop("api_key", None) or os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            raise ValueError(
                "bedrock_mantle needs a Bedrock API key in OPENAI_API_KEY. "
                "Create a long-term key in the Bedrock console under API keys."
            )
        return OpenAICompatibleLLMClient(
            model=model or os.environ.get("BEDROCK_MANTLE_MODEL", DEFAULT_MANTLE_MODEL),
            base_url=base_url,
            api_key=api_key,
            **kwargs,
        )
    raise ValueError(f"unknown LLM provider: {provider!r}")
