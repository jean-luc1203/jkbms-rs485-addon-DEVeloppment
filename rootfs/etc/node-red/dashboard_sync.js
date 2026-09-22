#!/usr/bin/env node
"use strict";

const fs = require("fs");

const action = String(process.argv[2] || "upsert").toLowerCase();
const filePath = process.argv[3] || "/config/dashboards/smart_jkbms.json";

const token = process.env.SUPERVISOR_TOKEN;
const wsUrl = "ws://supervisor/core/websocket";

if (!token) {
  console.error(JSON.stringify({ ok: false, error: "Supervisor token missing" }));
  process.exit(1);
}

if (typeof WebSocket === "undefined") {
  console.error(JSON.stringify({ ok: false, error: "Global WebSocket not available" }));
  process.exit(1);
}

let input = null;

if (fs.existsSync(filePath)) {
  try {
    input = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: `Invalid dashboard JSON in file: ${filePath}` }));
    process.exit(1);
  }
} else if (action !== "delete") {
  console.error(JSON.stringify({ ok: false, error: `Dashboard file not found: ${filePath}` }));
  process.exit(1);
}

const dashboardMeta = input?.dashboard_meta || {};
const dashboardConfig = input?.config || input || {};

const knownDashboardPaths = {
    "smart_jkbms.json": "smart-jkbms",
    "smart_jkbms_2.json": "smart-jkbms-2",
    "smart_energy_premium.json": "smart-energy-premium",
    "smart_jkbms_multipack.json": "smart-jkbms-multipack"
};
const expectedPath = knownDashboardPaths[require("path").basename(filePath)];
const declaredPath = dashboardMeta.url_path;
if ((expectedPath && declaredPath && declaredPath !== expectedPath) ||
    (!expectedPath && !declaredPath)) {
    console.error(JSON.stringify({ok:false, action, file:filePath,
        error:"Dashboard target missing or inconsistent with filename"}));
    process.exit(1);
}
const urlPath = expectedPath || declaredPath;
const title = dashboardMeta.title || "Smart JK-BMS";
const icon = dashboardMeta.icon || "mdi:battery";
const showInSidebar = dashboardMeta.show_in_sidebar !== false;
const requireAdmin = !!dashboardMeta.require_admin;

const ws = new WebSocket(wsUrl);
let nextId = 1;
const pending = new Map();
let finished = false;

function finishOk(extra = {}) {
  if (finished) return;
  finished = true;

  console.log(JSON.stringify({
    ok: true,
    action,
    dashboard: urlPath,
    title,
    file: filePath,
    ...extra
  }));

  try { ws.close(); } catch (_) {}
  process.exit(0);
}

function finishErr(error) {
  if (finished) return;
  finished = true;

  console.error(JSON.stringify({
    ok: false,
    action,
    dashboard: urlPath,
    title,
    file: filePath,
    error: String(error || "Unknown error")
  }));

  try { ws.close(); } catch (_) {}
  process.exit(1);
}

function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
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
    if (isAlreadyExistsError(err)) {
      return false;
    }

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
  } catch (err) {
    // Some HA versions may reject update or mode here.
    // Saving the dashboard config is still sufficient.
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

async function listDashboards() {
  const result = await call("lovelace/dashboards/list");
  return Array.isArray(result) ? result : [];
}

async function deleteDashboardRegistration() {
  const dashboards = await listDashboards();

  const dashboard = dashboards.find((item) =>
    String(item?.url_path || "") === String(urlPath)
  );

  if (!dashboard) {
    return {
      deleted: false,
      already_missing: true,
      dashboard_id: null
    };
  }

  if (!dashboard.id) {
    throw new Error(`Dashboard found without id for url_path=${urlPath}`);
  }

  await call("lovelace/dashboards/delete", {
    dashboard_id: dashboard.id
  });

  return {
    deleted: true,
    already_missing: false,
    dashboard_id: dashboard.id
  };
}

async function deleteOrphanDashboardConfig() {
  try {
    await call("lovelace/config/delete", {
      url_path: urlPath
    });

    return true;
  } catch (err) {
    if (isMissingError(err)) {
      return false;
    }

    throw err;
  }
}

async function deleteDashboard() {
  let dashboardResult;

  try {
    // Correct removal for a storage dashboard:
    // remove the dashboard registration itself so the sidebar/panel disappears.
    dashboardResult = await deleteDashboardRegistration();
  } catch (err) {
    // If dashboard listing/deletion is unavailable for some reason,
    // preserve the historical cleanup behavior rather than failing immediately.
    const configDeleted = await deleteOrphanDashboardConfig();

    return {
      deleted: configDeleted,
      dashboard_deleted: false,
      config_deleted: configDeleted,
      already_missing: !configDeleted,
      registration_cleanup_error: String(err?.message || err)
    };
  }

  // Normally lovelace/dashboards/delete also removes the associated storage
  // dashboard. This second cleanup is intentionally idempotent and removes a
  // possible orphan config if one remains.
  const configDeleted = await deleteOrphanDashboardConfig();

  return {
    deleted: dashboardResult.deleted || configDeleted,
    dashboard_deleted: dashboardResult.deleted,
    config_deleted: configDeleted,
    already_missing: dashboardResult.already_missing && !configDeleted,
    dashboard_id: dashboardResult.dashboard_id
  };
}

ws.onerror = (event) => {
  finishErr(event?.message || "WebSocket error");
};

ws.onmessage = async (event) => {
  let msg;

  try {
    msg = JSON.parse(event.data.toString());
  } catch (e) {
    finishErr("Invalid websocket message");
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
    finishErr("Authentication failed");
    return;
  }

  if (msg.type === "auth_ok") {
    try {
      let result;

      if (action === "delete") {
        result = await deleteDashboard();
      } else {
        result = await createOrUpdateDashboard();
      }

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
      waiter.reject(new Error(msg.error?.message || "Home Assistant error"));
    } else {
      waiter.resolve(msg.result);
    }
  }
};
