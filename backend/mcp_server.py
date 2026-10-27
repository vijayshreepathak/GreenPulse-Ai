"""Launcher for the GreenPulse AI MCP server that works from any working directory.

MCP client configuration: command = the backend virtual-environment Python,
args = [absolute path to this file]. See app/mcp_server.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.mcp_server import main  # noqa: E402

if __name__ == "__main__":
    main()
