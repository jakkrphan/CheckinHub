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

The project now has a Next.js scaffold, a Prisma schema and initial migration, Auth.js Credentials sign-in, server-side access guards, and an organizer event list backed by database queries. Database migration and end-to-end sign-in still need a configured MySQL connection. The requested event registration and check-in flows are specified in `ระบบเช็คชื่ออบรม.md`, with UI references in `checkin-mockup-b/`; most of those flows are not implemented yet.

## Product Principles

- Optimize for the moment of arrival: the check-in action itself must be fast and low-friction for staff under time pressure.
- Prefer clarity for staff over guest-facing polish, unless a future decision makes this guest-facing.
- Do not fabricate a competitive differentiator; ship what's confirmed and flag gaps.
