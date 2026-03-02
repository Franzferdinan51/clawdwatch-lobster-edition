---
name: clawdwatch
description: "OSINT agent for real-time conflict intelligence — monitors flights, ships, satellites, social media, and news feeds."
---

# Clawdwatch Skill

Real-time open-source intelligence aggregation and analysis.

## Capabilities

- Monitor ADS-B flight data for military movements
- Track ship AIS data for naval activity
- Scrape social media for ground reports
- Aggregate news from multiple sources/languages
- AI-powered anomaly detection and correlation
- Push alerts via Telegram/Discord

## Usage

```bash
# Start monitoring
clawdwatch start

# Check status
clawdwatch status

# Get latest intel briefing
clawdwatch briefing

# Set up alerts
clawdwatch alert --telegram <chat_id>
```

## Configuration

Set the following in your environment:

```bash
ADSB_EXCHANGE_API_KEY=xxx
MARINE_TRAFFIC_API_KEY=xxx
TELEGRAM_BOT_TOKEN=xxx
```
