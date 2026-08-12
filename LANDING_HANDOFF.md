# SafeHaul Landing Page — AI Handoff Document

## Context
A new AI is taking over this task. Read this document fully before touching any files.

---

## What Was Approved

The user approved the **"Fluid Deep Dive" (B1)** design direction for a complete rebuild of the SafeHaul public landing page (`landing/index.html`).

**The production rewrite has NOT yet started.** All work so far is in the prototype folder.

---

## The Approved Hero (LOCKED — do not change the first view)

The user explicitly approved this exact hero view (screenshot confirmed):

- **Headline:** "The intelligent flow of trucking compliance."
- **Sub:** "From recruiting to dispatch, SafeHaul organizes your entire safety workflow into one seamless, automated ecosystem."
- **One button only:** "Explore SafeHaul" — white pill button (`border-radius: 35px`), dark text, subtle glow shadow
- **Button Action:** Opens an interactive modal form (work email + fleet size → "Request Demo")
- **Hero Height:** Strict `min-height: calc(100vh - 72px)` — nothing below the hero is visible until the user scrolls
- **Background:** Deep navy `#070C13` with a subtle dot-grid overlay (`28px` spacing) and a soft teal ambient glow at the top center

**Hard rules for the hero:**
- ❌ No eyebrow pills / badge tags
- ❌ No trust strips / company logos in the hero
- ❌ No second button ("See How It Works" etc.)
- ❌ No dashboard placeholder boxes / glass panels
- ❌ No "DOT Compliant · FMCSA Certified" text anywhere
- ❌ No content visible below the fold on first load

## Approved Final Page Structure & Design System

**Approved Design System:** **Apple Pro Glassmorphism** (Selected 2026-08-12)

The production landing page (`landing/index.html` & `landing/assets/css/landing.css`) adopts the following exact design specifications:

1. **Design System Specs (Apple Pro Glassmorphism):**
   - **Canvas & Spacing:** Spacious `140px` section gaps with max container width of `1280px`.
   - **Glassmorphism Surfaces:** `backdrop-filter: blur(24px)` on cards (`rgba(31, 41, 55, 0.6)`) with `32px` border-radius and subtle inset glow borders (`rgba(255, 255, 255, 0.1)`).
   - **Typography:** Outfit (Display/Headings) + Inter (Body/Subtext), with generous line-heights (`1.65`) and `-0.03em` heading letter-spacing.
   - **Background Motion:** Fluid morphing semi-circle orb (`.morph-semi-ball`) with organic scale shifts (`@keyframes morphOrb`) combined with floating dot grid overlay (`36px` spacing).

2. **Hero View (LOCKED):** Strict `100vh` hero with headline, subtext, white "Explore SafeHaul" pill button, and verbatim inline SVG logo.
3. **B1 Section:** "Operational Excellence — Built for the Modern Carrier Fleet" (Asymmetric 7+5 and 12-col cards with real editorial photography).
4. **B7 Section:** "Calculate Your Fleet's Annual Efficiency Gain" (Interactive fleet size slider widget computing monthly hours and dollars saved + cinematic photo band).
5. **Pricing & FAQ:** 3-tier pricing grid and interactive accordion FAQ.
6. **Footer & Modal:** Clean footer and lead capture modal.

---

- **Photography Layout:** Asymmetric 12-column grid with `7+5` card split, plus a full-width `12-col` highway banner card
- **Card Behavior:** Hover lifts cards `-8px` with `scale(1.01)`, images zoom `scale(1.05)` on hover
- **Card Structure:** Each card has an `img-frame` (320px height, `object-fit: cover`) + `card-content` with tag/title/description
- **Full Banner Card:** 2-column grid — left side has text + CTA button, right side has full-bleed highway photograph
- **Real Photography Used:**
  - Driver with mobile app → `/shared/assets/truck_driver_mobile_app.jpg`
  - Fleet manager in ops center → `/shared/assets/fleet_manager_office.jpg`
  - Semi truck on highway at dusk → `/shared/assets/trucking_fleet_dusk.jpg`

### B2 — Interactive Story Tabs (Approved ✅)
**File:** `landing-prototypes/b2/index.html`
**URL:** `http://localhost:4184/b2/`

- **Tab Navigation:** 3 clickable tab buttons with accent border glow on active state
- **Showcase Panel:** Large 2-column card — left side has dynamic text (title + description + CTA), right side has 440px photograph
- **Tab Switching:** JavaScript swaps title, description, and image with a smooth crossfade (`opacity 0→1`, `scale 0.97→1`) on click
- **Tab Data:**
  1. "Driver Mobile App" → `truck_driver_mobile_app.jpg`
  2. "Fleet Safety Command" → `fleet_manager_office.jpg`
  3. "Highway Scale Network" → `trucking_fleet_dusk.jpg`

### B7 — Interactive Fleet ROI Calculator (Approved ✅)
**File:** `landing-prototypes/b7/index.html`
**URL:** `http://localhost:4184/b7/`

- **Interactive Feature:** "Calculate Your Fleet's Annual Efficiency Gain"
- **Controls:** Fleet size slider (10 to 500 trucks)
- **Live Output:** Dynamic computation of monthly admin hours saved (`trucks * 3`), compliance cost savings (`trucks * $120`), 100% audit readiness guarantee, and 48hr implementation speed.

---

## Shared Sections (present in both B1 and B2)

### Pricing (3-tier grid)
| Tier | Price | Key Features |
|---|---|---|
| Starter | $199/mo | Digital Driver Applications, DQ File Management, Basic MVR Checks |
| Growth | $499/mo | Everything in Starter + Continuous MVR Monitoring + ELD & TMS Integrations |
| Enterprise | Custom | Everything in Growth + Custom Integrations + Dedicated Support |

### FAQ (accordion)
- "How long does implementation take?" → 48 hours
- "Does SafeHaul integrate with our ELD?" → Samsara, Motive, Geotab

### Footer
- 4-column grid: Brand description | Platform links | Company links | Legal links
- Clean bottom bar: `© 2026 SafeHaul Technologies, Inc. All rights reserved.`
- No compliance credential text

### Modal Form (triggered by all "Explore SafeHaul" buttons)
- Fields: Work Email (required), Fleet Size (select: 1-25 / 26-100 / 100+)
- Submit button: teal `#0BE2A4` background, "Request Demo"
- Backdrop: `rgba(0,0,0,0.8)` with `blur(10px)`
- Card animation: `translateY(20px) scale(0.95)` → zero on open

---

## Logo — Critical Rules

The correct logo SVG (verbatim from `src/shared/components/Logo.jsx`):

```html
<svg width="40" height="34" viewBox="0 0 150 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M84.5048 0H38.3646C35.6441 0 33.1101 1.38249 31.6377 3.67003L10.0621 37.1892C7.65527 40.9284 8.00677 45.8078 10.9247 49.1634L34.5051 76.2809C35.4547 77.373 36.831 78 38.2782 78H84.5043C85.3578 78 85.819 76.9996 85.2647 76.3506L60.1709 46.969C57.4395 43.7709 57.2872 39.1074 59.8042 35.7379L85.306 1.59845C85.7986 0.938977 85.328 0 84.5048 0Z" fill="url(#paint0_linear_logo)"/>
  <path d="M76.26 51.5H115.994C118.229 51.5 120.362 52.4346 121.876 54.0776L143.684 77.7336C146.805 81.1193 147.211 86.1988 144.667 90.037L120.983 125.763C120.057 127.16 118.492 128 116.816 128H68.9479C68.5459 128 68.3082 127.549 68.5353 127.218L96.563 86.2541C98.8806 82.8668 98.613 78.3405 95.9123 75.2499L75.8835 52.329C75.6009 52.0056 75.8306 51.5 76.26 51.5Z" fill="#004C68"/>
  <path d="M145.426 0.0370348L97.1296 0.476095C95.4834 0.49106 93.9501 1.31535 93.0296 2.68018L67.603 40.3817C66.7071 41.7101 67.6589 43.5 69.2612 43.5H111.534C114.663 43.5 117.611 42.0361 119.501 39.5439L147.038 3.24572C148.042 1.92198 147.088 0.0219304 145.426 0.0370348Z" fill="#0BE2A4"/>
  <path d="M83.603 85.5H34.9709C33.4135 85.5 31.9451 86.2257 30.9991 87.4627L2.45845 124.785C1.45208 126.101 2.39046 128 4.04717 128H51.8679C55.0895 128 58.1139 126.448 59.9923 123.83L85.2279 88.6661C86.1775 87.3428 85.2318 85.5 83.603 85.5Z" fill="#004C68"/>
  <defs>
    <linearGradient id="paint0_linear_logo" x1="42.5" y1="55" x2="83" y2="75.5" gradientUnits="userSpaceOnUse">
      <stop offset="0.283654" stop-color="#0CE1A5"/>
      <stop offset="0.913462" stop-color="#077B5A"/>
    </linearGradient>
  </defs>
</svg>
```

**Rules:**
- Always embed as inline SVG — never `<img src="logo.svg">`
- The `#004C68` navy shapes are visible because the background is `#070C13`. Do NOT darken the background further.
- Never use `logo.svg` from `landing/assets/images/` — it has graphite fills, invisible on dark.
- Logo mark is always followed by `<span>SafeHaul</span>` in `Outfit 700`.
- Footer logo uses same SVG but with `width="28" height="24"` and a **separate** gradient ID (`paint0_linear_logo_footer`).

---

## Color System

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#070C13` | `#FFFFFF` |
| `--text` | `#FFFFFF` | `#0B1221` |
| `--text-muted` | `#94A3B8` | `#64748B` |
| `--accent` | `#0BE2A4` | `#0BE2A4` |
| `--surface` | `#101622` | `#F8FAFC` |
| `--surface-card` | `#151D2A` | `#FFFFFF` |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.08)` |
| `--border-strong` | `rgba(255,255,255,0.15)` | `rgba(0,0,0,0.15)` |

## Typography
- **Outfit** (300–700) — headlines, buttons, brand wordmark
- **Inter** (400–600) — body, labels, nav

---

## Prototype Location

```
c:\Users\tom\Documents\GitHub\SafeHaul\landing-prototypes\
├── b1\index.html   ← Parallax Float Cards (Approved)
├── b2\index.html   ← Interactive Story Tabs (Approved)
├── b3\index.html   ← Editorial Split-Screen (Not approved)
├── shared\assets\  ← Generated editorial photographs
│   ├── truck_driver_mobile_app.jpg
│   ├── fleet_manager_office.jpg
│   └── trucking_fleet_dusk.jpg
├── index.html      ← Prototype hub page
└── vite.config.js  ← Dev server config
```

Start the dev server with:
```
cd c:\Users\tom\Documents\GitHub\SafeHaul\landing-prototypes
npx vite --port 4184
```

---

## What Still Needs to Happen

### 1. Combine B1 + B2 into Final Design
The user approved both directions. The next step is to decide whether to:
- Use B1's parallax photo cards for the main feature section + B2's tab showcase for a secondary section
- Pick one as primary and borrow individual elements from the other
- Ask the user which combination they prefer

### 2. Real Production Assets
The generated photographs are placeholders for layout purposes. For production:
- Replace with licensed stock photography or original brand photography
- Consider actual screenshots of the SafeHaul app for product showcases

### 3. Production Rewrite
The approved prototype must be ported into the production landing directory:
- **Target file:** `c:\Users\tom\Documents\GitHub\SafeHaul\landing\index.html`
- This is a monolithic HTML file. It must be **fully replaced**, not patched.

### 4. Design Constraints (User Rules)
The user said "it must NOT look AI-generated". Hard rules:
- ❌ No purple gradient blobs
- ❌ No 3-card symmetric grids (use asymmetric bento)
- ❌ No fake testimonials
- ❌ No glassmorphism overload
- ❌ No oversized elements

---

## Audience

The page targets **two audiences equally:**
1. **Trucking companies** — want to see recruiting, safety, DQ file, MVR monitoring automation
2. **Investors** — want to see institutional credibility, scale, and technical sophistication

---

## Existing Customer Logos (real images, available for trust strips)

```
landing/assets/images/company_logos/is-truckers.png
landing/assets/images/company_logos/stl-truckers.png
landing/assets/images/company_logos/true-nation.png
```
