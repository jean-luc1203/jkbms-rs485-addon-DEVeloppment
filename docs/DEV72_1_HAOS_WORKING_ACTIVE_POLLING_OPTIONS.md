# DEV72.1 — Configuration HAOS éprouvée en Active Polling (exemple anonymisé)

> Configuration **des options de l'add-on** (onglet Configuration HAOS), **pas** le fichier source `config.yaml` du dépôt. Observée sur un Home Assistant OS de production le 17 octobre 2026 avec SmartPhoton Multi-Pack `1.0.0-dev72.1`. Les IP, identifiants et secrets ne sont pas reproduits. Adapter les ports, le câble et le matériel à chaque installation.

## Résultat observé

- Runtime `/config/smartphoton_jkbms_multipack/` : confirmé dans les journaux de démarrage.
- Node-RED 5.0.8, MQTT connecté et dashboards SCADA / Multi-Pack synchronisés.
- 4 packs en ligne, 10 BMS remontés : un pack physique USB-RS485 (2 BMS, **adresses 1 et 2**), et trois packs TCP de laboratoire simulés (2 + 2 + 4 BMS).
- Mode Active Polling confirmé. Le scan `auto` inclut `0..15`, mais **le BMS physique d'adresse 0 n'a pas encore été testé** dans ce relevé.
- Aucun essai simultané RS485-1 Active Polling / RS485-2 Broadcasting validé dans ce relevé.
- Les correctifs SCADA Recorder provenaient de DEV70.1 testé localement ; poursuivre la surveillance Recorder de DEV72.1.

## Exemple d'options — même structure que la configuration fonctionnelle

```yaml
communication_debug: false
bms_broadcasting: false

multi_pack_enabled: true
multi_pack_active_polling: true
multi_pack_packs:
  - id: pack_1
    name: "Pack 1 - Real"
    transport: serial
    path: "/dev/serial/by-id/usb-REPLACE_WITH_YOUR_ADAPTER"
    bms_addresses: "auto"  # Découverte 0..15 ; 1 et 2 observés sur ce site

  # Packs TCP de laboratoire, facultatifs — supprimer pour un site réel à un seul pack
  - id: pack_2
    name: "Pack 2 - Lab"
    transport: tcp
    gateway_ip_port: "192.0.2.10:5031"
    bms_addresses: "1,2"
  - id: pack_3
    name: "Pack 3 - Lab"
    transport: tcp
    gateway_ip_port: "192.0.2.10:5032"
    bms_addresses: "1,2"
  - id: pack_4
    name: "Pack 4 - Lab"
    transport: tcp
    gateway_ip_port: "192.0.2.10:5033"
    bms_addresses: "1,2,3,4"

jkbms_path: "/dev/serial/by-id/usb-REPLACE_WITH_YOUR_ADAPTER"
jkbms_count: 1
use_gateway: false
gateway_ip_port: "192.0.2.20:5000"
non_broadcasting_data_interval_s: 3
CAN_bus_usage: false

mqttadresse_port: "core-mosquitto.local.hass.io:1883"
mqttuser: "REPLACE_WITH_MQTT_USER"
mqttpass: "REPLACE_WITH_MQTT_PASSWORD"
long_term_statistics: cells
Send_bip: false

premium_key: ""  # Ajouter individuellement une licence valide dans HAOS ; jamais dans GitHub
dashboard_custom_cards_installed: true
dashboard_language: fr
dashboard_mode: legacy
```

La **configuration de développement du site pilote** comporte des champs de séparation visuels `*_section` fournis par `config.yaml` ; l'interface HAOS les gère normalement. La valeur `dashboard_mode: legacy` désigne ici un choix d'affichage, **pas le runtime du Legacy**. Les quatre packs, les ports et les identifiants ne sont pas des valeurs par défaut universelles. Les adresses `192.0.2.0/24` sont réservées à la documentation et ne sont pas exploitables sur un réseau client.

## Variante : test physique de l'Issue #31 (non encore validé)

Conserver uniquement un pack série, et après adressage physique des deux JK-BMS sur UART1/RS485-1, configurer :

```yaml
multi_pack_enabled: true
multi_pack_active_polling: true
bms_broadcasting: false
CAN_bus_usage: false
multi_pack_packs:
  - id: pack_1
    name: "Pack RS485-1 réel"
    transport: serial
    path: "/dev/serial/by-id/usb-REPLACE_WITH_YOUR_ADAPTER"
    bms_addresses: "0,2"
```

Ne pas lancer JK-BMS-MONITOR en parallèle sur RS485-1 ; observer d'abord SETUP/STATIC/LIVE en lecture seule et vérifier l'identification de chaque adresse. La validation simultanée RS485-2 en Broadcasting requiert une installation/instance séparée selon [le protocole Issue #31](ISSUE31_DEV71_TESTING.md).

## Points de compatibilité critiques

- **Slug add-on Multi-Pack** : `smartphoton_jkbms_multipack` (distinct du Legacy).
- **userDir Node-RED** : `/config/smartphoton_jkbms_multipack/` ; sous-répertoires `nodes`, `global-variables`, `settings.js`, `flows.json` et `version` dédiés au Multi-Pack.
- **Les flows livrés dans l'image font référence pendant le développement** : ils sont recopiés au démarrage ; des changements faits uniquement depuis l'éditeur Node-RED peuvent être écrasés.
- **Le fichier source `config.yaml` contient les valeurs par défaut et le schéma de l'add-on**, pas les options personnalisées du site pilote. Ne jamais copier les mots de passe MQTT, tokens ou clés Premium vers le dépôt public.
- **Les dashboards sont partagés dans HAOS**, mais les chemins/identifiants du Multi-Pack sont distincts du Legacy.
