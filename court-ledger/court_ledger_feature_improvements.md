# Court Ledger — Feature Improvement Proposal

## Current State Summary

Your Court Ledger app is a single-page HTML app (localStorage-based) with RBAC, a global player directory, pairwise balance netting, and a two-party payment acknowledgment flow. It's functional but has UX friction and is missing several features that would make it genuinely useful for sports groups managing shared finances.

Below are improvements grouped by priority, drawing on what works well in Cashbook and adding sports-specific value.

---

## 🔴 Priority 1 — Fix Core UX Pain Points

### 1.1 Book Management (Create / Rename / Delete)

**Problem:** Creating a new book requires navigating to a bottom-sheet picker, and renaming a book is buried or missing entirely. Cashbook makes "Add New Book" a single prominent button.

**Improvements:**
- Add a large **"+ New Book"** card at the top of the All Books screen — one tap to name it and go
- Add an **inline rename** option: long-press or tap the edit icon next to the book name in the header
- Add **book archiving** (soft-delete) instead of hard-delete — old seasons / tournaments shouldn't disappear, just move to an "Archived" section at the bottom
- Show the book's **net position** (total owed / total due) right on the book card in the list, the way Cashbook shows the balance number (e.g., 4,774 or −135)

### 1.2 Adding Members Should Be Frictionless

**Problem:** Adding members currently opens a bottom-sheet form. For a group of 8–12 players, this is tedious.

**Improvements:**
- **Batch-add via phone contacts**: let the user pick multiple contacts at once (using the Contact Picker API on mobile browsers) — names and numbers pre-filled
- **Invite link / QR code**: generate a shareable link or QR so players can add themselves to the book
- **Quick-add chip bar**: after typing a name, pressing Enter immediately adds the member and clears the field — no extra "Save" tap needed
- **Copy members from another book**: one-tap to import the same group into a new book (very common when the same squad plays weekly)

### 1.3 Editing Entries

**Problem:** Editing a booking currently requires expanding the card, then hitting "Edit," which re-opens the full form. There's no way to quickly fix a typo or adjust the amount.

**Improvements:**
- **Inline amount edit**: tap the amount directly to change it
- **Swipe actions** (on mobile): swipe left to delete, swipe right to edit
- **Duplicate entry**: one-tap to copy a previous booking (same venue, same players, just update the date) — most groups play the same court weekly

---

## 🟡 Priority 2 — Cross-Book Visibility & Settlement

### 2.1 Cross-Book Consolidated View (Your Key Ask)

This is the most impactful new feature. Currently, each book is an island — you can't see your total exposure across all books.

**New Screen: "My Finances" or "Overview"**

- **Net position per person across all books**: "You owe Hamid ₹800 total (₹500 from Badminton Book + ₹300 from Equipment Book)"
- **Net position per book**: a stacked bar or simple list showing your balance in each book
- **Grand total**: one number — your total net receivable or payable across everything
- **Drill-down**: tap any person → see the book-by-book breakdown of how that net was calculated
- **Settle across books**: when settling with a person, allow a single payment that clears dues across multiple books at once (the system distributes the payment proportionally or lets you choose)

### 2.2 Smart Settlement Suggestions

**Problem:** The current "Settle Up" shows minimum-transactions netting, but doesn't guide the user to actually make the payment.

**Improvements:**
- **One-tap UPI deep-link**: generate a `upi://pay?pa=...&am=...` link that opens the user's UPI app pre-filled
- **Settlement reminders**: allow a user to send a gentle nudge (in-app notification + optional WhatsApp message) to someone who owes them
- **Partial settlements**: let someone pay ₹500 of a ₹800 due — the remaining ₹300 stays tracked
- **Settlement history timeline**: show all past settlements between two people as a scrollable timeline

---

## 🟢 Priority 3 — Filters, Reports & Data Insights

### 3.1 Filters (Inspired by Cashbook)

Cashbook lets you filter entries by date range, members, and transaction type. Court Ledger needs the same.

- **Date range picker**: "This month / Last month / Custom range"
- **Filter by member**: show only entries involving a specific person
- **Filter by activity type**: only court bookings, only equipment purchases, only payments
- **Filter by venue**: useful for groups that play at multiple courts
- **Search bar**: full-text search across entry notes, venues, and member names

### 3.2 Reports

- **Monthly summary report**: total spent, per-person contribution, most frequent venue, busiest day of the week
- **Exportable PDF / Excel**: download a ledger statement for a date range — useful when a player leaves the group and wants a final accounting
- **Per-person statement**: "Faisal's Ledger" — every entry they were part of, their share, payments made, running balance — like a bank statement
- **WhatsApp-shareable summary**: already partially present (📲 button), but should be richer — include per-person balances, not just totals
- **Spending trends**: simple bar chart showing monthly spending across books

### 3.3 Dashboard / Home Screen Widgets

- **"Who owes you the most"** leaderboard
- **"Your biggest expense this month"** highlight card
- **"Upcoming settlements"** — if you implement reminder dates, show approaching due dates

---

## 🔵 Priority 4 — Sports-Specific Features

These differentiate Court Ledger from a generic expense splitter.

### 4.1 Court Booking Templates

- **Recurring bookings**: "Every Saturday 8–10 PM at XYZ Courts" — auto-create the entry, just confirm the player list
- **Venue directory**: save frequently used courts with address, rate per hour, and contact
- **Slot management**: pick from pre-defined time slots instead of typing start/end times

### 4.2 Equipment Tracking

- **Shared equipment log**: track who bought what (shuttles, balls, nets), cost, and split
- **Equipment fund**: a separate running pool where everyone contributes monthly, and purchases deduct from it — avoids per-purchase splitting fatigue

### 4.3 Attendance & Fair-Split

- **Attendance tracker**: mark who showed up for each session — if someone didn't play, they shouldn't be split on that booking
- **Guest handling**: occasional players who aren't regular members — add them temporarily with a "guest" tag, track their dues separately
- **Weighted splits**: allow custom split ratios (e.g., court booker pays less because they did the work of booking)

---

## ⚙️ Priority 5 — Technical & Platform Improvements

### 5.1 Move Beyond localStorage

**Problem:** Right now everything is in `localStorage` — data is stuck on one device, can't be shared between members, and is lost if the browser cache is cleared.

**Options (in order of recommendation):**
1. **Supabase or Firebase backend**: real-time sync, proper multi-user auth, push notifications for payment acknowledgments
2. **PWA with IndexedDB + sync**: works offline, syncs when online
3. **At minimum**: add JSON export/import (you have this partially) and make it more prominent — add a periodic auto-backup prompt

### 5.2 Proper Multi-User Support

The current "identity simulator" is a development tool. For real use:
- **Phone number / OTP login**: lightweight auth, no passwords
- **Each player sees only their own view** by default — no role-switching bar
- **Real push notifications** when someone marks a payment as sent

### 5.3 Mobile App (React Native / Expo)

The app is designed mobile-first but runs in a browser. A proper mobile app would enable:
- Contact picker for adding members
- UPI intent deep-links for payments
- Push notifications
- Offline-first with background sync

---

## Summary: Recommended Build Order

| Phase | What to Build | Impact |
|-------|--------------|--------|
| **Phase 1** | Fix book CRUD (create/rename/archive), quick-add members, entry duplication | Removes immediate frustration |
| **Phase 2** | Cross-book consolidated view, per-person net across books, cross-book settlement | Your key differentiator |
| **Phase 3** | Filters (date/member/type), monthly reports, PDF export | Makes the app feel professional |
| **Phase 4** | Recurring bookings, venue directory, equipment fund, attendance | Sports-specific value |
| **Phase 5** | Backend (Supabase/Firebase), real multi-user auth, push notifications | Makes it a real multi-player product |
| **Phase 6** | Mobile app with UPI deep-links, contact picker, offline support | Best experience for the target audience |

---

*Would you like me to start building any of these phases? I'd recommend beginning with Phases 1–3 as a proper web app with a real backend, which would give you a working product your group can actually use together.*
