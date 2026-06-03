#!/usr/bin/env python3
"""Wrapper léger : délègue à bb-workflow generate.

Conservé pour compatibilité avec les utilisateurs habitués à `python3 build.py`.
"""
import subprocess
import sys


def main():
    cmd = ["bb-workflow", "generate"]
    result = subprocess.run(cmd, capture_output=False)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
