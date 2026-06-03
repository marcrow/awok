"""Pytest fixtures for the awok / bb-workflow tests."""
import importlib.util
import sys
from pathlib import Path
from importlib.machinery import SourceFileLoader

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
BBW_SCRIPT_PATH = REPO_ROOT / "claude-setup" / "scripts" / "bb-workflow"


@pytest.fixture(scope="session")
def bbw_module():
    """Load bb-workflow as a Python module."""
    loader = SourceFileLoader("bbw", str(BBW_SCRIPT_PATH))
    spec = importlib.util.spec_from_loader("bbw", loader)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.modules["bbw"] = mod
    return mod
