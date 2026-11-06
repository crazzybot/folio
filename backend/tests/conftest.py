from pathlib import Path

import pytest

# tests/fixtures at the repo root, shared with the desktop app's tests
FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
WORKSPACE = FIXTURES / "workspace"
SKIP_DIRS = frozenset({".git", "node_modules"})


@pytest.fixture
def workspace() -> Path:
    return WORKSPACE
