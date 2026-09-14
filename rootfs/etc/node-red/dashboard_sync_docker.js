#!/usr/bin/env node
"use strict";

const fs = require("fs");
const WebSocket = require("ws");

const action = String(process.argv[2] || "upsert").toLowerCase();
const filePath =
    process.argv[3] || "/config/dashboards/smart_jkbms.json";

function deriveWsUrl(haUrl) {
    const raw = String(haUrl || "").trim();
    if (!raw) return "";

    let u;
    try {
        u = new URL(raw);
    } catch (_) {
        return "";
    }

    if (u.protocol === "http:") u.protocol = "ws:";
    else if (u.protocol === "https:") u.protocol = "wss:";
    else if (!["ws:", "wss:"].includes(u.protocol)) return "";

    u.pathname = "/api/websocket";
    u.search = "";
    u.hash = "";
    return u.toString();
}

// Canonical standalone variables.
const haUrl = String(process.env.HA_URL || "").trim();
const token = String(
    process.env.HA_TOKEN ||
    process.env.SUPERVISOR_TOKEN ||
    ""
).trim();

const wsUrl = String(
    process.env.HA_WS_URL ||
    process.env.WS_URL ||
    deriveWsUrl(haUrl) ||
    ""
).trim();

if (!token) {
    console.error(JSON.stringify({
        ok: false,
        error:
            "Home Assistant token missing. Set HA_TOKEN " +
            "(SUPERVISOR_TOKEN is accepted for compatibility)."
    }));
    process.exit(1);
}

if (!wsUrl) {
    console.error(JSON.stringify({
        ok: false,
        error:
            "Home Assistant WebSocket URL missing. Set HA_URL, " +
            "HA_WS_URL or WS_URL."
    }));
    process.exit(1);
}

let parsedWsUrl;
try {
    parsedWsUrl = new URL(wsUrl);
} catch (_) {
    console.error(JSON.stringify({
        ok: false,
        error: `Invalid Home Assistant WebSocket URL: ${wsUrl}`
    }));
    process.exit(1);
}

if (!["ws:", "wss:"].includes(parsedWsUrl.protocol)) {
    console.error(JSON.stringify({
        ok: false,
        error: `WebSocket URL must use ws:// or wss://: ${wsUrl}`
    }));
    process.exit(1);
}

let input = null;

if (fs.existsSync(filePath)) {
    try {
        input = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (_) {
        console.error(JSON.stringify({
            ok: false,
            error: `Invalid dashboard JSON in file: ${filePath}`
        }));
        process.exit(1);
    }
} else if (action !== "delete") {
    console.error(JSON.stringify({
        ok: false,
        error: `Dashboard file not found: ${filePath}`
    }));
    process.exit(1);
}

const dashboardMeta = input?.dashboard_meta || {};
const dashboardConfig = input?.config || input || {};

const urlPath = dashboardMeta.url_path || "smart-jkbms";
const title = dashboardMeta.title || "Smart JK-BMS";
const icon = dashboardMeta.icon || "mdi:battery";
const showInSidebar = dashboardMeta.show_in_sidebar !== false;
const requireAdmin = !!dashboardMeta.require_admin;

let ws;
let nextId = 1;
const pending = new Map();
let finished = false;

const CONNECT_TIMEOUT_MS = 15000;
let connectTimer = null;

function clearConnectTimer() {
    if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
    }
}

function finishOk(extra = {}) {
    if (finished) return;
    finished = true;
    clearConnectTimer();

    console.log(JSON.stringify({
        ok: true,
        action,
        dashboard: urlPath,
        title,
        file: filePath,
        websocket: wsUrl,
        ...extra
    }));

    try { ws?.close(); } catch (_) {}
    process.exit(0);
}

function finishErr(error) {
    if (finished) return;
    finished = true;
    clearConnectTimer();

    console.error(JSON.stringify({
        ok: false,
        action,
        dashboard: urlPath,
        title,
        file: filePath,
        websocket: wsUrl,
        error: String(error || "Unknown error")
    }));

    try { ws?.close(); } catch (_) {}
    process.exit(1);
}

function call(type, payload = {}) {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error("Home Assistant WebSocket is not open"));
            return;
        }

        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, type, ...payload }));
    });
}

function isAlreadyExistsError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return (
        msg.includes("exists") ||
        msg.includes("already") ||
        msg.includes("configured")
    );
}

function isMissingError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return (
        msg.includes("not found") ||
        msg.includes("unknown") ||
        msg.includes("does not exist") ||
        msg.includes("no config") ||
        msg.includes("not configured")
    );
}

async function createDashboardIfNeeded() {
    try {
        await call("lovelace/dashboards/create", {
            url_path: urlPath,
            title,
            icon,
            show_in_sidebar: showInSidebar,
            require_admin: requireAdmin,
            mode: "storage"
        });
        return true;
    } catch (err) {
        if (isAlreadyExistsError(err)) return false;
        throw err;
    }
}

async function updateDashboardInfoIfPossible() {
    try {
        await call("lovelace/dashboards/update", {
            url_path: urlPath,
            title,
            icon,
            show_in_sidebar: showInSidebar,
            require_admin: requireAdmin,
            mode: "storage"
        });
        return true;
    } catch (_) {
        // Non-blocking compatibility fallback:
        // saving the Lovelace config is sufficient.
        return false;
    }
}

async function saveDashboardConfig() {
    await call("lovelace/config/save", {
        url_path: urlPath,
        config: dashboardConfig
    });
    return true;
}

async function createOrUpdateDashboard() {
    const createdDashboard = await createDashboardIfNeeded();
    const updatedDashboard = await updateDashboardInfoIfPossible();
    const saved = await saveDashboardConfig();

    return {
        created_dashboard: createdDashboard,
        updated_dashboard: updatedDashboard,
        saved
    };
}

async function deleteDashboard() {
    try {
        await call("lovelace/config/delete", {
            url_path: urlPath
        });
        return {
            deleted: true,
            already_missing: false
        };
    } catch (err) {
        if (isMissingError(err)) {
            return {
                deleted: false,
                already_missing: true
            };
        }
        throw err;
    }
}

try {
    ws = new WebSocket(wsUrl);
} catch (err) {
    finishErr(err?.message || err);
}

connectTimer = setTimeout(() => {
    finishErr(
        `Home Assistant WebSocket connection/authentication timeout ` +
        `after ${CONNECT_TIMEOUT_MS} ms`
    );
}, CONNECT_TIMEOUT_MS);

ws.on("error", (err) => {
    finishErr(err?.message || "WebSocket error");
});

ws.on("close", () => {
    if (!finished) {
        finishErr("Home Assistant WebSocket closed unexpectedly");
    }
});

ws.on("message", async (raw) => {
    let msg;

    try {
        msg = JSON.parse(raw.toString());
    } catch (_) {
        finishErr("Invalid WebSocket message");
        return;
    }

    if (msg.type === "auth_required") {
        ws.send(JSON.stringify({
            type: "auth",
            access_token: token
        }));
        return;
    }

    if (msg.type === "auth_invalid") {
        finishErr(msg.message || "Authentication failed");
        return;
    }

    if (msg.type === "auth_ok") {
        clearConnectTimer();

        try {
            const result =
                action === "delete"
                    ? await deleteDashboard()
                    : await createOrUpdateDashboard();

            finishOk(result);
        } catch (err) {
            finishErr(err?.message || err);
        }
        return;
    }

    if (Object.prototype.hasOwnProperty.call(msg, "id")) {
        const waiter = pending.get(msg.id);
        if (!waiter) return;

        pending.delete(msg.id);

        if (msg.success === false) {
            waiter.reject(
                new Error(
                    msg.error?.message ||
                    msg.error?.code ||
                    "Home Assistant error"
                )
            );
        } else {
            waiter.resolve(msg.result);
        }
    }
});
