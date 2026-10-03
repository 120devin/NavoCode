#!/usr/bin/env python3
"""Direct Python entry point; installs and runs without pip dependencies."""
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from navocode.cli import entry
if __name__ == '__main__':
    raise SystemExit(entry())
