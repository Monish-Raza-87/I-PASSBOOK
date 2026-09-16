# I-PASSBOOK — Project Knowledge Base

> **Purpose:** This `docs/` folder serves as an Obsidian-style knowledge base. Future Claude sessions can read these files instead of re-reading the entire codebase, saving significant context tokens.

---

## Quick Links

| File | What it contains |
|---|---|
| [[01 - Project Overview]] | What this app is, who it's for, tech stack |
| [[02 - Architecture & Data Flow]] | Frontend ↔ Backend ↔ Sheets flow; who owns which data |
| [[03 - Sections Reference]] | The 6 passbook sections (B–G), the Overview panel, and the 📋 Report intake tab, with field definitions |
| [[04 - Backend API Reference]] | GAS endpoint actions, params, responses, access control, sentinel stores |
| [[05 - Configuration & Secrets]] | What's hardcoded, what needs replacing before deploy |
| [[06 - UI Components & Styling]] | Design system tokens, component patterns |
| [[07 - Known Issues & TODO]] | Current bugs, tech debt, planned features, test suites |
| [[08 - Development Guide]] | How to run locally, dev mode, tests, deploying |
| [[09 - Design System]] | Token provenance, the generator, why the palette ships twice |
| [[10 - Auth & Access Model]] | How someone gets in, and what they may do — the canonical write-up |

---

## One-Liner Summary

**I-PASSBOOK** is a mobile-first PWA for Indrones staff to manage drone
repair/return tickets (IRs) — built with vanilla HTML/CSS/JS and a Google Apps
Script backend.

The client's **Google Form is the intake**; its Sheet is the immutable record of
what the customer reported. The app owns everything mutable about a ticket
(status, assignee, priority, type), and it shows the client's report in full on a
read-only **📋 Report** tab, so support staff work in one place instead of two.