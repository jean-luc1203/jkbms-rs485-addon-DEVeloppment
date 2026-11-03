"""DEV76: read-only, admin-only GLOW journal over authenticated HA WebSocket.

No remote HTTP endpoint. No access to other Node-RED global context.
Requires 'smartphoton_glow_journal:' in Home Assistant configuration.yaml.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

_LOGGER = logging.getLogger(__name__)
DOMAIN = "smartphoton_glow_journal"
CONTEXT_PATH = (
    "smartphoton_jkbms_multipack/glow-journal-store/global/global.json"
)
MAX_FILE_BYTES = 1024 * 1024
MAX_EVENTS = 250

CONFIG_SCHEMA = vol.Schema(
    {vol.Optional(DOMAIN): vol.Schema({})},
    extra=vol.ALLOW_EXTRA,
)


def _read_journal(hass: HomeAssistant) -> dict[str, Any]:
    """Read isolated Node-RED context file in executor, with size limit."""
    path = Path(hass.config.path(CONTEXT_PATH))
    try:
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            return {"available": False, "reason": "too_large", "events": []}
        with path.open("r", encoding="utf-8") as stream:
            raw = json.load(stream)
    except FileNotFoundError:
        return {"available": False, "reason": "not_initialized", "events": []}
    except (OSError, ValueError, UnicodeError):
        _LOGGER.warning("Cannot read isolated GLOW journal context", exc_info=True)
        return {"available": False, "reason": "read_error", "events": []}
    if not isinstance(raw, dict):
        return {"available": False, "reason": "invalid_format", "events": []}
    journal = raw.get("jkbms_glow_journal_v1")
    if not isinstance(journal, dict) or not isinstance(journal.get("events"), list):
        return {"available": False, "reason": "not_initialized", "events": []}
    # Whitelist every output attribute. Never forward arbitrary context metadata.
    clean = []
    for event in journal["events"][:MAX_EVENTS]:
        if not isinstance(event, dict):
            continue
        timestamp = event.get("t")
        if type(timestamp) not in (int, float) or timestamp <= 0:
            continue
        clean.append(
            {
                "id": str(event.get("id", ""))[:180],
                "t": int(timestamp),
                "cat": str(event.get("cat", ""))[:24],
                "lvl": str(event.get("lvl", ""))[:16],
                "pack": str(event.get("pack", ""))[:24],
                "bms": str(event.get("bms", ""))[:24]
                if event.get("bms") is not None
                else None,
                "txt": str(event.get("txt", ""))[:140],
                "det": str(event.get("det", ""))[:220],
            }
        )
    return {"available": True, "reason": None, "events": clean}


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/list",
        vol.Optional("limit", default=100): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=250)
        ),
        vol.Optional("pack"): vol.Match(r"^pack_[1-5]$"),
        vol.Optional("bms"): vol.Match(r"^(master|\\d{1,2})$"),
        vol.Optional("category"): vol.In(["alarm", "param", "flow", "bal"]),
        vol.Optional("since"): vol.All(vol.Coerce(int), vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_list_journal(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Read and filter private journal; never mutates it."""
    result = await hass.async_add_executor_job(_read_journal, hass)
    if not result["available"]:
        connection.send_result(msg["id"], result)
        return
    events = result["events"]
    if "pack" in msg:
        events = [e for e in events if e["pack"] == msg["pack"]]
    if "bms" in msg:
        events = [e for e in events if e["bms"] == msg["bms"]]
    if "category" in msg:
        events = [e for e in events if e["cat"] == msg["category"]]
    if "since" in msg:
        events = [e for e in events if e["t"] >= msg["since"]]
    result["total"] = len(events)
    result["events"] = events[:msg["limit"]]
    connection.send_result(msg["id"], result)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register secure WebSocket command after configuration load."""
    websocket_api.async_register_command(hass, ws_list_journal)
    return True
