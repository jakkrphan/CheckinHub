# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js, deployed to Vercel

## Users

Event and venue staff (hosts, front-of-house, organizers) who check in attendees or guests at an event, venue, or front desk.

## Product Purpose

CheckInHub lets event/venue staff check people in as they arrive, replacing ad hoc methods (paper lists, spreadsheets, generic form tools) with a dedicated check-in flow.

## Positioning

Undecided. The specific mechanism or edge over spreadsheets/generic form tools/existing check-in SaaS has not been confirmed yet — do not invent a differentiator (e.g. QR speed, real-time dashboard) until the user confirms one.

## Operating Context

Staff perform check-ins as attendees/guests arrive at an event, venue, or front desk — likely a fast-paced, standing/mobile use context, though device and environment specifics are not yet confirmed.

## Capabilities and Constraints

The local development flow now covers organizer event creation and publishing, public registration with dynamic fields and conditional logic, approval and waitlist lifecycle, private status links and QR codes, organizer registrant management and CSV export, check-in with undo and an encrypted offline queue, and system administration with audit logs. Local attachments and cover images use private disk storage. This is a development-ready local flow, not a production-ready deployment: production still needs persistent private object storage, email and LINE delivery/login, Turnstile credentials, LDAP configuration from the organization's directory team, and browser/device acceptance checks. Credentials sign-in is temporary for development. UI references are in `docs/checkin-mockup-b v3/checkin-mockup-b/`.

## Product Principles

- Optimize for the moment of arrival: the check-in action itself must be fast and low-friction for staff under time pressure.
- Prefer clarity for staff over guest-facing polish, unless a future decision makes this guest-facing.
- Do not fabricate a competitive differentiator; ship what's confirmed and flag gaps.
