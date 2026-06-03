"""Optional runtime service lifecycle for sandbox supervisor."""

import os
from collections.abc import Awaitable, Callable

from .docker_service import DockerService

ReportFatalError = Callable[[str], Awaitable[None]]

DOCKER_ENABLED_ENV_VAR = "OPENINSPECT_DOCKER_ENABLED"
SANDBOX_IMAGE_PROFILE_ENV_VAR = "OPENINSPECT_SANDBOX_IMAGE_PROFILE"


class RuntimeServices:
    """Owns optional sidecar services started by the sandbox supervisor."""

    def __init__(self, log, docker: DockerService | None = None):
        self.log = log
        self.docker = docker

    @classmethod
    def from_env(cls, log) -> "RuntimeServices":
        image_profile = os.environ.get(SANDBOX_IMAGE_PROFILE_ENV_VAR, "default")
        if os.environ.get(DOCKER_ENABLED_ENV_VAR, "").lower() != "true":
            log.info(
                "runtime_services.docker_disabled",
                image_profile=image_profile,
            )
            return cls(log)

        log.info(
            "runtime_services.docker_enabled",
            image_profile=image_profile,
        )
        return cls(log, docker=DockerService.from_env(log))

    async def start_before_hooks(self) -> None:
        if not self.docker:
            return
        await self.docker.start()

    async def ensure_healthy(self, report_fatal_error: ReportFatalError) -> bool:
        if not self.docker:
            return True

        if not self.docker.has_crashed():
            return True

        exit_code = self.docker.exit_code
        self.log.error("docker.crash", exit_code=exit_code)
        await report_fatal_error(f"dockerd exited unexpectedly with code {exit_code}")
        return False

    async def stop(self) -> None:
        if not self.docker:
            return
        await self.docker.stop()
