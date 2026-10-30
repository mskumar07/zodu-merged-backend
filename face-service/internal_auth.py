"""Service-to-service authentication, same scheme as @zodu/security.

Each calling service sends its own token in X-Internal-Token; this service
holds the tokens of the services it accepts (INTERNAL_TOKEN_<CALLER>).
No token or an unknown one -> 401; a known service not allowed here -> 403.
"""

import hashlib
import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException

PREFIX = "INTERNAL_TOKEN_"
MIN_TOKEN_LENGTH = 32


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


def caller_tokens(env=os.environ) -> dict:
    """INTERNAL_TOKEN_EMPLOYEE=... -> {"employee": sha256(token)}; short tokens are ignored."""
    return {
        k[len(PREFIX):].lower(): _digest(v)
        for k, v in env.items()
        if k.startswith(PREFIX) and len(v) >= MIN_TOKEN_LENGTH
    }


def require_internal(*callers: str, tokens: Optional[dict] = None):
    """FastAPI dependency: Depends(require_internal("employee"))."""
    known = caller_tokens() if tokens is None else tokens
    allowed = {c.lower() for c in callers}

    def check(x_internal_token: Optional[str] = Header(default=None)) -> str:
        caller = None
        if x_internal_token:
            presented = _digest(x_internal_token)
            # Compare against every token so the timing doesn't reveal which one matched.
            for name, digest in known.items():
                if hmac.compare_digest(presented, digest) and caller is None:
                    caller = name
        if caller is None:
            raise HTTPException(status_code=401, detail="Invalid internal token")
        if allowed and caller not in allowed:
            raise HTTPException(status_code=403, detail="Service not allowed")
        return caller

    return check
