from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from fire_viewer.core.config import Settings
from fire_viewer.domain.enums import ActorType
from fire_viewer.domain.errors import ForbiddenError, UnauthorizedError

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class Actor:
    actor_id: str
    roles: frozenset[str]
    actor_type: ActorType = ActorType.OPERATOR

    def has_any_role(self, required: set[str] | frozenset[str]) -> bool:
        return bool(self.roles.intersection(required))

    def has_all_roles(self, required: set[str] | frozenset[str]) -> bool:
        return required.issubset(self.roles)


class JwtVerifier:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jwk_client = (
            PyJWKClient(str(settings.oidc_jwks_url), cache_keys=True)
            if settings.oidc_jwks_url
            else None
        )

    def verify(self, token: str) -> Actor:
        if self._jwk_client is None:
            raise UnauthorizedError("JWT verification is not configured.")
        try:
            signing_key = self._jwk_client.get_signing_key_from_jwt(token)
            claims: dict[str, Any] = jwt.decode(
                token,
                signing_key.key,
                algorithms=self.settings.oidc_algorithms,
                audience=self.settings.oidc_audience,
                issuer=self.settings.oidc_issuer,
                leeway=self.settings.oidc_leeway_seconds,
                options={"require": ["exp", "iat", "sub"]},
            )
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("The bearer token is invalid or expired.") from exc

        actor_id = str(claims.get("sub", "")).strip()
        if not actor_id:
            raise UnauthorizedError("The bearer token has no subject.")

        raw_roles = claims.get(self.settings.oidc_roles_claim, [])
        if isinstance(raw_roles, str):
            roles = frozenset(part for part in raw_roles.replace(",", " ").split() if part)
        elif isinstance(raw_roles, list):
            roles = frozenset(str(role) for role in raw_roles)
        else:
            roles = frozenset()
        return Actor(actor_id=actor_id, roles=roles)


def actor_from_request(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> Actor:
    settings: Settings = request.app.state.settings
    if settings.auth_mode == "disabled":
        if settings.environment not in {"development", "test"}:
            raise UnauthorizedError("Disabled authentication is not allowed in this environment.")
        return Actor(
            actor_id="local-development-operator",
            roles=frozenset({"administrator", "analyst", "validator", "security_operator"}),
        )

    if credentials is None or credentials.scheme.casefold() != "bearer":
        raise UnauthorizedError()
    verifier: JwtVerifier = request.app.state.jwt_verifier
    return verifier.verify(credentials.credentials)


def require_role(actor: Actor, *roles: str) -> None:
    if not actor.has_any_role(set(roles)):
        raise ForbiddenError(f"One of the following roles is required: {', '.join(roles)}")
