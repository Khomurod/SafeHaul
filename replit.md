# SafeHaul HR Portal

## Overview
SafeHaul is a driver recruitment and HR management platform connecting CDL drivers with carrier companies. The platform provides features for:
- Driver application submission and tracking
- Company recruitment management
- Lead distribution system
- Bulk messaging (SMS/Email)
- Digital document signing

## Tech Stack
- **Frontend**: React 19 + Vite 7
- **Styling**: Tailwind CSS
- **Backend**: Firebase (Firestore, Cloud Functions, Auth, Storage)
- **UI Libraries**: Lucide React (icons), Framer Motion (animations), Recharts (charts)
- **PDF**: PDF.js, jsPDF

## Project Structure
```
├── src/                    # React frontend source
│   ├── App.jsx            # Main application component
│   ├── main.jsx           # Entry point
│   ├── config/            # Configuration files
│   ├── context/           # React contexts
│   ├── features/          # Feature modules
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility libraries
│   └── shared/            # Shared components
├── functions/             # Firebase Cloud Functions
├── public/                # Static assets
└── index.html             # HTML entry point
```

## Development
- **Dev Server**: `npm run dev` (runs on port 5000)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Test**: `npm run test`

## Configuration
- Vite is configured to run on `0.0.0.0:5000` with `allowedHosts: true`
- Firebase configuration is in `src/config/`
- Environment variables are in `.env` and `.env.local`

## Key Architecture Patterns
1. **Real-time Listeners**: Firestore `onSnapshot` for dashboards
2. **Cloud Functions**: Heavy processing and third-party integrations
3. **Submission Queue**: IndexedDB-based offline queue for driver applications
4. **Lead Distribution**: Fair "Dealer" algorithm for lead assignment

## Deployment
- Deploy target: Static (client-side only)
- Build command: `npm run build`
- Output directory: `dist`
