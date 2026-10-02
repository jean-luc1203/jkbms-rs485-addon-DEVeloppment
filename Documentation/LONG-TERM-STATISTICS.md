# Home Assistant Long-Term Statistics

SmartPhoton can selectively add `state_class: measurement` to eligible MQTT Discovery sensors.

This allows Home Assistant to build long-term statistics for useful BMS measurements while keeping Recorder/statistics growth under control.

## Configuration

```yaml
long_term_statistics: "cells"
```

Available values:

- `off` — do not opt SmartPhoton numeric sensors into long-term statistics.
- `essential` — core BMS/pack measurements only: SOC/SOH, voltage, current, power, remaining capacity, cell summary values and temperatures.
- `cells` — `essential` plus individual cell voltages. **Recommended default.**
- `full` — all eligible numeric sensors. This creates the largest long-term statistics footprint.

## Why `cells` is recommended

Cell-voltage history is useful for detecting increasing imbalance and gradual cell degradation. At the same time, there is little benefit in creating long-term statistics for every numeric configuration or diagnostic value.

## Applying a change

When `long_term_statistics` is changed, SmartPhoton republishes MQTT Discovery so Home Assistant can update the entity metadata.

No entity IDs or MQTT state topics are changed by this option.

## Recorder note

`state_class: measurement` makes a compatible sensor eligible for Home Assistant long-term statistics. Home Assistant still manages its Recorder retention and long-term statistics independently.
