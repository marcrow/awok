"""Pytest fixtures for the awok / bb-workflow tests."""
import importlib.util
import sys
from pathlib import Path
from importlib.machinery import SourceFileLoader

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
BBW_SCRIPT_PATH = REPO_ROOT / "src" / "scripts" / "bb-workflow"


@pytest.fixture(scope="session")
def bbw_module():
    """Load bb-workflow as a Python module."""
    loader = SourceFileLoader("bbw", str(BBW_SCRIPT_PATH))
    spec = importlib.util.spec_from_loader("bbw", loader)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.modules["bbw"] = mod
    return mod


@pytest.fixture
def restore_roots(bbw_module):
    """Snapshot the module's root globals and restore them after the test.

    Tests that call _apply_roots() with a temp workdir mutate shared module
    state; this puts ENGINE_ROOT/CONTENT_ROOT (and all DEFAULT_* derived from
    them) back to their import-time values so other tests are unaffected.
    """
    eng, content = bbw_module.ENGINE_ROOT, bbw_module.CONTENT_ROOT
    yield
    bbw_module._apply_roots(eng, content)
