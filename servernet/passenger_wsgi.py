# SPDX-License-Identifier: AGPL-3.0-only
"""Set Passenger's app root to this directory and Python to its private venv."""
import atexit
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from servernet.hosted.app import configured_app
from servernet.hosted.passenger import PassengerApplication

application = PassengerApplication(configured_app())
atexit.register(application.close)
