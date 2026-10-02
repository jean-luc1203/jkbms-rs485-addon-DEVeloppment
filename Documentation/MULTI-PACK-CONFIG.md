# Multi-Pack → Packs Configuration

The **Multi-Pack → Packs** section defines the JK-BMS communication interfaces used by the add-on.

Each pack represents one independent RS485 communication bus.

A pack can use:

- a local USB/RS485 adapter (`serial`)
- an RS485-to-TCP/IP gateway (`tcp`)

Each bus can contain one or several JK-BMS units.

---

## Pack fields

### `id`

Stable technical identifier for the pack.

Recommended values:

```text
pack_1
pack_2
pack_3
pack_4
pack_5
```

Do not change the pack ID after commissioning unless necessary.

---

### `name`

Friendly name displayed in Home Assistant and the dashboards.

Examples:

```text
Main battery
Garage
Technical room
Pack 1 - Real
```

---

### `transport`

Available values:

```text
serial
```

for a USB/RS485 adapter directly connected to Home Assistant.

or:

```text
tcp
```

for an RS485-to-TCP/IP gateway.

---

### `path`

Required when:

```text
transport: serial
```

Use a persistent device path whenever possible:

```text
/dev/serial/by-id/...
```

Example:

```text
/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0
```

Avoid using `/dev/ttyUSB0` when possible, as this name may change after a reboot.

---

### `gateway_ip_port`

Required when:

```text
transport: tcp
```

Format:

```text
IP_ADDRESS:PORT
```

Example:

```text
192.168.0.175:5031
```

---

### `bms_addresses`

Used by **Multi-Pack Active Polling**.

The recommended setting is:

```yaml
bms_addresses: "auto"
```

In `auto` mode SmartPhoton scans JK-BMS addresses **1 to 15** when the Active Polling runtime starts and keeps every address that answers correctly.

The scan does **not** stop at the first missing address. A bus containing:

```text
1,3,7
```

is therefore valid and will be detected correctly.

Manual/expert mode remains available:

```yaml
bms_addresses: "1,3,7"
```

Manual addresses must be unique on the same RS485 bus and between **1 and 15**.

If the field is omitted or empty, Active Polling also uses automatic discovery.

Automatic discovery uses a dedicated short probe timeout. An absent address is considered normal during the scan and does not trigger the heavy runtime timeout/reconnect behaviour used for a real communication failure.

---

# Configuration examples

## 1. One USB/RS485 interface — automatic discovery

```yaml
multi_pack_enabled: true
multi_pack_active_polling: true

multi_pack_packs:
  - id: pack_1
    name: Pack 1 - Real
    transport: serial
    path: /dev/serial/by-id/usb-1a86_USB_Serial-if00-port0
    bms_addresses: "auto"
```

Typical use:

```text
Home Assistant
      │
      USB
      │
USB/RS485 adapter
      │
      ├── BMS address 1
      └── BMS address 2
```

---

## 2. One TCP/IP gateway — automatic discovery

```yaml
multi_pack_enabled: true
multi_pack_active_polling: true

multi_pack_packs:
  - id: pack_1
    name: Pack 1 - TCP
    transport: tcp
    gateway_ip_port: 192.168.0.175:5031
    bms_addresses: "auto"
```

---

## 3. Manual / expert address list

```yaml
multi_pack_enabled: true
multi_pack_active_polling: true

multi_pack_packs:
  - id: pack_1
    name: Workshop
    transport: serial
    path: /dev/serial/by-id/usb-1a86_USB_Serial-if00-port0
    bms_addresses: "1,3,7"
```

Use manual mode only when you intentionally want to limit polling to known addresses.

---

## 4. Several independent packs

Each pack has its own independent communication interface and can use automatic discovery independently.

```yaml
multi_pack_enabled: true
multi_pack_active_polling: true

multi_pack_packs:
  - id: pack_1
    name: House
    transport: serial
    path: /dev/serial/by-id/usb-1a86_USB_Serial-if00-port0
    bms_addresses: "auto"

  - id: pack_2
    name: Garage
    transport: tcp
    gateway_ip_port: 192.168.0.131:8887
    bms_addresses: "auto"

  - id: pack_3
    name: Workshop
    transport: tcp
    gateway_ip_port: 192.168.0.175:5032
    bms_addresses: "1,2"
```

The same BMS addresses may be reused on different packs because the buses are independent.

---

# Home Assistant long-term statistics

The add-on can selectively add:

```yaml
state_class: measurement
```

to eligible MQTT Discovery sensors so Home Assistant can generate long-term statistics.

Configuration:

```yaml
long_term_statistics: "cells"
```

Available modes:

| Mode | Behaviour |
|---|---|
| `off` | No SmartPhoton numeric sensors are opted into long-term statistics |
| `essential` | Main BMS/pack values, SOC/SOH, voltage/current/power, capacity summaries, cell summary and temperatures |
| `cells` | `essential` plus individual cell voltages — recommended default |
| `full` | All eligible numeric sensors; largest Recorder/statistics footprint |

`cells` is the recommended default because it keeps useful degradation/imbalance history while avoiding unnecessary long-term statistics for every numeric diagnostic/configuration entity.

Changing this option republishes MQTT Discovery so Home Assistant can update the `state_class` metadata.

Note: enabling long-term statistics does not mean every raw state is kept forever in Recorder. Home Assistant creates its own long-term statistics for eligible sensors.

---

# Quick rules

```text
1 independent RS485 interface = 1 pack

USB/RS485:
    transport: serial
    path: /dev/serial/by-id/...

RS485 over TCP/IP:
    transport: tcp
    gateway_ip_port: IP:PORT

Active Polling:
    bms_addresses: "auto"     # recommended
or
    bms_addresses: "1,3,7"    # manual/expert mode

Long-term statistics:
    long_term_statistics: "cells"  # recommended

Maximum currently supported:
    5 packs
```

Important:

- Keep each `id` stable.
- Use persistent `/dev/serial/by-id/...` paths for USB adapters.
- Do not configure the same serial device path for two different packs.
- Each TCP pack should use its own gateway or TCP endpoint.
- BMS addresses must be unique on the same RS485 bus.
- The same BMS addresses can be reused on different packs.
- Automatic Active Polling discovery scans addresses 1 through 15 and supports gaps such as `1,3,7`.
