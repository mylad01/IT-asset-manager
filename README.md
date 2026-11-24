<div align="center">

# Studio IT Sync &bull; Enterprise IT Asset & Operations Manager

[![Built by mylad01](https://img.shields.io/badge/Author-mylad01-blue.svg?style=flat&logo=github)](https://github.com/mylad01)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg?style=flat&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff.svg?style=flat&logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-v4-06b6d4.svg?style=flat&logo=tailwindcss)](https://tailwindcss.com/)
[![Express 5](https://img.shields.io/badge/Express-5-000000.svg?style=flat&logo=express)](https://expressjs.com/)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL%20Mode-003b57.svg?style=flat&logo=sqlite)](https://sqlite.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933.svg?style=flat&logo=node.js)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A mission-critical, full-stack IT Operations & Hardware Asset Management platform engineered for studio, media production, and enterprise creative environments. Combines real-time telemetry, hardware lifecycle tracking, dynamic QR label printing, Kanban helpdesk dispatching, threaded messaging, and staff leave approvals inside a custom glassmorphism design system.

[Explore Features](#-core-feature-tour) &bull;
[Architecture](#-system-architecture--engineering-highlights) &bull;
[Getting Started](#-getting-started--installation) &bull;
[Test Credentials](#-seeded-test-credentials) &bull;
[Author](#-author--contact)

---

</div>

## Overview

**Studio IT Sync** is built from the ground up to solve the real operational friction of fast-paced production studios: losing track of expensive camera kits, audio gear, high-end workstations, software licenses, and repair requests across studio floors and remote teams.

Designed with an ultra-responsive liquid-glass aesthetic, bulletproof SQLite concurrency controls, automated database migration tracking, and role-based access control, Studio IT Sync delivers enterprise-grade reliability in a single, high-performance footprint.

---

## ⚡ System Architecture & Engineering Highlights

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Studio IT Sync Architecture                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Frontend Client (React 19 + Vite 6 + Tailwind CSS 4)                │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  Design Token Glass Engine (9 Themes: Dark, Matcha, Noir...)   │   │
│   │  Unified WebSocket Client (Real-time Broadcasts & Feeds)       │   │
│   │  Optimistic Table Preferences & Dynamic Column Visibility      │   │
│   └────────────────────────┬───────────────────────────────────────┘   │
│                            │ REST API + WebSocket                      │
│                            ▼                                           │
│   Backend Server (Express 5 + Node 22+)                                │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  Multi-Role RBAC (Root Admin, IT Admin, Staff, Read-Only)      │   │
│   │  Rate-Limiting & Security Throttling (Helmet, Brute-Force Gate)│   │
│   │  Unified Event Bus & Live WebSockets Manager                   │   │
│   └────────────────────────┬───────────────────────────────────────┘   │
│                            │ WAL Concurrency                           │
│                            ▼                                           │
│   Persistence Layer (SQLite3 / Better-SQLite3)                         │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │  Write-Ahead Logging (WAL) Mode with Single-Writer Lock        │   │
│   │  Umzug Migration Runner (Up & Down Transactional Steps)        │   │
│   │  Automated Hot Backups & Verified Disaster Recovery Drills     │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Engineering Pillars

- **Pure Semantic Design System**: Engineered using CSS custom properties (`--color-*`, `--glass-*`, `--text-*`). Never hardcodes raw palette classes in UI components, ensuring fluid, 100% theme switching across all 9 presets without UI flashing.
- **SQLite Concurrency & WAL Mode**: Configured with `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, and custom application-level single-writer mutex gates to eliminate SQLite lock contention during simultaneous read/write bursts.
- **Production-Grade Migrations**: Uses [Umzug](https://github.com/sequelize/umzug) to track, execute, and verify database schema migrations both forward and rollback, ensuring consistent states across development and production deployments.
- **Live WebSocket Push Engine**: Bidirectional WebSocket synchronization pushes immediate toast alerts and updates whenever hardware is checked out, tickets change state, or new messages arrive.
- **Enterprise Multi-Role RBAC**:
  - **Root Admin**: Full system authority, user provisioning, security overrides, and system settings.
  - **IT Admin**: Hardware asset lifecycle, storage inventory, helpdesk dispatcher, and leave approvals.
  - **Staff**: Self-service asset requests, personal inventory overview, helpdesk ticketing, leave submissions, and direct messaging.
  - **Read-Only**: Auditor access to reports, asset types, consumables, and activity logs without mutation privileges.

---

## 🚀 Core Feature Tour

### 1. Hardware Asset Inventory & Lifecycle Management
- Track complete asset lifecycles: **Available**, **In-Use**, **Maintenance**, **Storage**, and **Decommissioned**.
- Filter by Category, Location, Assigned User, Condition, and Status.
- **QR Code Engine**: Generate and print batch QR asset labels with one click (`qrcode.react` + custom print layouts) for physical tagging and smartphone camera barcode scanning via the built-in Scan Station.

### 2. Helpdesk Dispatcher & Kanban Workspace
- **Dual View Modes**: Switch seamlessly between a rapid **Kanban Board** (drag/click state transitions) and a high-density **Dispatcher Table**.
- Prioritization matrix: Critical, High, Medium, Low with automated visual SLA warnings.
- Ticket audit trail: Tracks full reassignment history, status updates, technician notes, and linked inventory items.

### 3. Real-Time Conversation Workspace & Messaging
- Direct peer-to-peer and team messaging channels for staff and technicians.
- Integrated unread notification badges in the navigation sidebar.
- Live WebSocket event subscriptions with instantaneous message delivery and typing indicators.

### 4. Personnel Leave Management & Approvals
- Staff submission portal for Vacation, Medical, and Personal Leave with instant balance calculation.
- Administrative approval workflow with conflict calendar visualization.
- Notification bell and badge alerts for pending manager reviews.

### 5. Multi-Theme Glassmorphism Engine
Choose from **9 hand-crafted theme presets** with persistent local and cloud preferences:
- 🌌 **Studio Dark** (Default — deep indigo obsidian glass)
- ☀️ **Light Mode** (Clean, crisp studio daylight)
- 🖤 **Noir** (Monochrome high-fashion slate)
- 🍵 **Matcha** (Earthy, organic sage and botanical tones)
- 🔮 **Midnight Blue** (Deep oceanic navy glass)
- 💎 **Obsidian** (Pure black AMOLED contrast)
- 🌿 **Emerald Studio** (High-tech cyber emerald)
- 🌸 **Rose Quartz** (Refined warm champagne glass)
- ⚡ **Cyberpunk** (High-energy electric violet and amber)

---

## 🛠️ Tech Stack & Dependencies

| Area | Technologies |
| :--- | :--- |
| **Frontend Core** | React 19, React Router 7, Vite 6, Tailwind CSS 4 |
| **Icons & Visuals** | Lucide React, Recharts, Framer Motion |
| **Backend Core** | Node.js 22+, Express 5, CORS, Multer |
| **Database & Cache** | SQLite (Better-SQLite3 / SQLite3), WAL Mode, Umzug Migrations |
| **Security & Auth** | JWT (`jsonwebtoken`), `bcrypt`, `helmet`, `express-rate-limit` |
| **Realtime & Logging** | WebSockets (`ws`), Pino HTTP logger with daily rotation (`pino-roll`) |
| **Documents & Barcodes** | jsPDF, jsPDF-AutoTable, QRCode.react |
| **Quality & Auditing** | Oxlint, Puppeteer E2E test suites, k6 load testing scenarios |

---

## 📦 Getting Started & Installation

### Prerequisites
- **Node.js**: `v20.x` or `v22.x+`
- **npm**: `v10.x+`

### 1. Clone the Repository
```bash
git clone https://github.com/mylad01/IT-asset-manager.git
cd IT-asset-manager/IT-asset-manager
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Copy the sample environment file (or create `.env` in the project root):
```bash
# Server configuration
PORT=3000
NODE_ENV=development
JWT_SECRET=super_secret_studio_jwt_token_key_change_in_production

# Database configuration
DB_PATH=./server/db/database.sqlite
```

### 4. Initialize Database & Migrations
Run the automated migration runner and seed baseline accounts and inventory:
```bash
# Run schema migrations
npm run db:migrate

# Seed baseline demo data (Users, Assets, Helpdesk Tickets)
npm run seed:users
npm run seed:tickets
npm run seed:bulk
```
> *Or run a clean reset with a single command:* `npm run reset:db`

### 5. Launch Development Environment
```bash
# Starts backend server and Vite frontend concurrently
npm run dev
```

Visit **`http://localhost:5173`** in your browser.

---

## 🔑 Seeded Test Credentials

The database seeder provisions pre-configured accounts spanning every privilege tier:

| Role | Username | Email | Password | Access Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Root Admin** | `admin` | `admin@studio.com` | `admin` | Full system control, user provisioning, global settings |
| **IT Admin** | `admin1` | `admin1@studio.com` | `12345678` | Asset lifecycle, helpdesk dispatch, leave approvals |
| **IT Admin** | `admin2` | `admin2@studio.com` | `12345678` | Secondary IT admin account |
| **Staff** | `staff1` | `staff1@studio.com` | `12345678` | Self-service hardware requests, tickets, messaging |
| **Staff** | `staff2` | `staff2@studio.com` | `12345678` | Secondary staff account |
| **Read-Only** | `readonly` | `readonly1@studio.com` | `readonly1234` | Audit and inspection access |

---

## 🧪 Testing & Reliability Tooling

Studio IT Sync comes with comprehensive automated diagnostic and testing suites:

```bash
# Run oxlint across the entire codebase
npm run lint

# Run production Vite build
npm run build

# Run end-to-end Puppeteer UI user journey test
npm run test:ui

# Verify table first-load latency & query consistency
npm run test:tables

# Run automated database backup & disaster recovery drill
npm run test:restore

# Run k6 load test scenarios
npm run load:read
npm run load:write
npm run load:auth
```

---

## 👨‍💻 Author & Contact

Developed with passion by **mylad01**:

- **GitHub**: [@mylad01](https://github.com/mylad01)
- **Repository**: [https://github.com/mylad01/IT-asset-manager](https://github.com/mylad01/IT-asset-manager)
- **Email**: [miladnasrollahi.mn@gmail.com](mailto:miladnasrollahi.mn@gmail.com)

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
