# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |

## Reporting a vulnerability

Please email **anishguptaglobal@gmail.com** with details (impact, reproduction, affected component). Do not open a public issue for security reports. You'll get an acknowledgement within 72 hours and a fix or mitigation plan within 14 days for confirmed issues.

## Deployment guidance

- The API runs in open demo mode by default — set `API_KEY` before exposing it beyond localhost.
- The SQLite database file contains PII; keep it on encrypted storage and out of backups you don't control.
- In $0 mock mode no data leaves the machine. With `ANTHROPIC_API_KEY` set, only PII-redacted aggregate statistics are sent to the model API (see [ADR-0006](docs/adr/0006-aggregates-only-prompts.md)).

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full model.
