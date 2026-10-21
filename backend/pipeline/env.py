"""Load secrets from the repo's .env (gitignored) into the environment."""

from __future__ import annotations

import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_env(path: str = os.path.join(ROOT, ".env")) -> None:
    """Set variables from a KEY=value .env file unless already in the environment."""
    if not os.path.exists(path):
        return
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            if value.strip():
                os.environ.setdefault(key.strip(), value.strip())
