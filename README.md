# PracticeDesk

> **CA Practice Management & Billing Platform**  
> Developed by **Aryan Jayanth** (`sankaaryanjayanth@gmail.com`)

PracticeDesk is a multi-tenant practice management, job tracking, and billing solution built specifically for Chartered Accountant (CA) firms and financial practices in India. It includes native Indian currency formatting (`₹`), date formatting (`DD-MM-YYYY`), PAN/TAN/GSTIN validation, GST computation, multi-firm data isolation, and comprehensive financial audit trails.

---

## Key Features

- **Multi-Tenant Firm Architecture**: Hard data isolation between accounting firms powered by PostgreSQL Row Level Security (RLS). Super Admin firm switcher allows managing multiple firms.
- **Client & Retainer Management**: Client directory with PAN, TAN, GSTIN, business type, contact persons, and client service retainers.
- **Automated Recurring Job Engine**: Automatic daily recurring job generation for all active client services without duplicates.
- **Job & Task Tracking**: Granular tracking (`Pending` → `In Progress` → `Completed` / `On Hold` / `Cancelled`) with logged reasons and audit trails. Overdue status derived dynamically.
- **Invoicing & Billing**: Invoice generation from completed jobs, custom line items, automated GST calculation, discounts with reasons, and printable/PDF invoices.
- **Payment Clearing & Advances**: Unallocated payment pooling, FIFO auto-settlement against oldest unpaid invoices, partial payments, and cancellation/reversals with reason tracking.
- **Receivables & Ageing Analysis**: Real-time accounts receivable dashboard and bucketed ageing breakdown (Current, 1–30, 31–60, 61–90, 90+ days).
- **Bank Reconciliation**: CSV bank statement parsing with automatic reference (UTR/cheque) and date/amount tolerance matching.
- **Role-Based Access Control**: Strict access boundaries across Super Admin, Owner, Admin, Accountant, Staff, and Cashier.

---

## Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router)
- **Frontend**: [React 19](https://react.dev), [Tailwind CSS v4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [Recharts](https://recharts.org), [Lucide React](https://lucide.dev)
- **Backend / Database**: [Supabase](https://supabase.com) (PostgreSQL 15+, Row Level Security, RPCs, pg_cron)
- **Build Tool**: [Vite 8](https://vitejs.dev), [Nitro](https://nitro.unjs.io), TypeScript

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (v20+ recommended) or [Bun](https://bun.sh)
- A Supabase project with database schema applied from `docs/backend.sql`

### Environment Configuration

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-or-publishable-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

### Installation & Development

```sh
# Install dependencies
npm install

# Start local development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.  
Copyright (c) 2026 **Aryan Jayanth**.
