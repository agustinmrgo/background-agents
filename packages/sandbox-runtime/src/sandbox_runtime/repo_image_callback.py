"""Repo-image build callback reporting for build-mode sandboxes."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

from .auth import generate_internal_token
from .log_config import StructuredLogger, get_logger

CALLBACK_MAX_RETRIES = 3
CALLBACK_BACKOFF_BASE_SECONDS = 2
CALLBACK_TIMEOUT_SECONDS = 30.0
CALLBACK_USER_AGENT = "open-inspect/repo-image-builder"
ERROR_MESSAGE_MAX_CHARS = 500

BUILD_ID_ENV = "OI_REPO_IMAGE_BUILD_ID"
CALLBACK_URL_ENV = "OI_REPO_IMAGE_CALLBACK_URL"
CALLBACK_SECRET_ENV = "OI_REPO_IMAGE_CALLBACK_SECRET"
PROVIDER_SESSION_ID_ENV = "OI_REPO_IMAGE_PROVIDER_SESSION_ID"


@dataclass(frozen=True)
class RepoImageBuildCallback:
    """Authenticated callback reporter for image build mode."""

    build_id: str
    callback_url: str
    secret: str
    provider_session_id: str = ""
    logger: StructuredLogger = field(default_factory=lambda: get_logger("repo_image_callback"))

    @classmethod
    def from_env(cls, logger: StructuredLogger | None = None) -> RepoImageBuildCallback | None:
        """Create a callback reporter from build-mode environment variables."""
        build_id = os.environ.get(BUILD_ID_ENV, "")
        callback_url = os.environ.get(CALLBACK_URL_ENV, "")
        secret = os.environ.get(CALLBACK_SECRET_ENV, "")

        if not build_id and not callback_url and not secret:
            return None

        log = logger or get_logger("repo_image_callback")
        missing = [
            name
            for name, value in (
                (BUILD_ID_ENV, build_id),
                (CALLBACK_URL_ENV, callback_url),
                (CALLBACK_SECRET_ENV, secret),
            )
            if not value
        ]
        if missing:
            log.error("repo_image.callback_misconfigured", missing=missing)
            return None

        return cls(
            build_id=build_id,
            callback_url=callback_url,
            secret=secret,
            provider_session_id=os.environ.get(PROVIDER_SESSION_ID_ENV, ""),
            logger=log,
        )

    async def report_success(self, *, base_sha: str, build_duration_seconds: float) -> bool:
        """Report a successful repo-image build."""
        payload: dict[str, Any] = {
            "build_id": self.build_id,
            "base_sha": base_sha,
            "build_duration_seconds": round(build_duration_seconds, 3),
        }
        if self.provider_session_id:
            payload["provider_session_id"] = self.provider_session_id

        return await self._post_with_retry(self.callback_url, payload)

    async def report_failure(self, error: str) -> bool:
        """Report a failed repo-image build."""
        return await self._post_with_retry(
            build_failed_callback_url(self.callback_url),
            {
                "build_id": self.build_id,
                "error": error[-ERROR_MESSAGE_MAX_CHARS:],
            },
        )

    async def _post_with_retry(self, url: str, payload: dict[str, Any]) -> bool:
        for attempt in range(1, CALLBACK_MAX_RETRIES + 1):
            try:
                token = generate_internal_token(self.secret)
                async with httpx.AsyncClient(timeout=CALLBACK_TIMEOUT_SECONDS) as client:
                    response = await client.post(
                        url,
                        json=payload,
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json",
                            "User-Agent": CALLBACK_USER_AGENT,
                        },
                    )
                    response.raise_for_status()
                self.logger.info(
                    "repo_image.callback_success",
                    build_id=self.build_id,
                    url=url,
                    attempt=attempt,
                    status=response.status_code,
                )
                return True
            except Exception as exc:
                delay = CALLBACK_BACKOFF_BASE_SECONDS**attempt
                self.logger.warn(
                    "repo_image.callback_retry",
                    build_id=self.build_id,
                    url=url,
                    attempt=attempt,
                    max_retries=CALLBACK_MAX_RETRIES,
                    delay_s=delay,
                    error=str(exc),
                )
                if attempt < CALLBACK_MAX_RETRIES:
                    await asyncio.sleep(delay)

        self.logger.error(
            "repo_image.callback_failed",
            build_id=self.build_id,
            url=url,
            max_retries=CALLBACK_MAX_RETRIES,
        )
        return False


def build_failed_callback_url(callback_url: str) -> str:
    """Convert the success callback URL to the failure callback URL."""
    suffix = "/build-complete"
    if callback_url.endswith(suffix):
        return f"{callback_url[: -len(suffix)]}/build-failed"
    return callback_url
