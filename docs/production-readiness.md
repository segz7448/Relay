# Production readiness

## Server Relay

- [x] Read only: only GET routes are registered under `/relay`
- [x] Authenticated: every Relay route requires a valid user session
- [x] Authorized: server membership and private-channel membership are checked before reads
- [x] Paginated and ordered: signed cursor pages use stable timestamp/id order
- [x] Pollable: cursor polling returns ordered, deduplicatable message pages
- [x] Rate limited: Relay reads are bounded per authenticated user
- [x] Separate: Relay routes, data, and UI do not import or mutate bot state

## Bot system

- [x] Creatable and manageable through authenticated owner routes
- [x] Independently token-authenticated runtime surface
- [x] Multi-bot and multi-user with owner and bot isolation
- [x] Commands, inbound/outbound messages, conversations, analytics, and activity
- [x] Signed outbound webhooks with retry and delivery history
- [x] Private R2 files with size/MIME/ownership checks
- [x] Composite KV limits on bot mutations, bot-token validation, webhook ingress, and file upload
- [x] D1 is the durable source of truth; the client has no production mock or local message fallback

## Deployment prerequisites

Deployment remains intentionally blocked until real Cloudflare D1/KV IDs, a production CORS origin, and the documented GitHub/Worker secrets exist. These values are external infrastructure, not values the source code can safely invent.
