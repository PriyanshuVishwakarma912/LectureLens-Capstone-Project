# LectureLens
 
LectureLens turns YouTube lecture videos into clear, easy-to-read study notes. Paste a video link, and the app creates notes for you, so you do not have to watch the full lecture again.
  
## Problem
 
Long lectures take hours to watch. Taking notes by hand is slow, and it is easy to miss important points. LectureLens saves that time.
 
## Features
 
- Paste a YouTube link and get notes
- AI-written notes from the video content (Google Gemini API)
- Sign in and save your notes (Firebase)
- Download notes as a PDF
- Simple and clean web interface
## Tech Stack
 
| Part | Tool |
|------|------|
| Frontend | React 19, Vite, Tailwind CSS |
| Backend | Node.js, Express (`server.ts`) |
| Language | TypeScript |
| AI | Google Gemini (`@google/genai`) |
| Database and Auth | Firebase (Firestore) |
| PDF export | jsPDF |
 
## Project Structure
 
```
LectureLens-Capstone-Project/
├── src/                 # Frontend code (React)
├── server/              # Backend code
├── server.ts            # Express server entry point
├── firestore.rules      # Firebase database security rules
├── security_spec.md     # Security notes
├── .env.example         # Example environment variables
├── vite.config.ts       # Vite settings
└── package.json         # Dependencies and scripts
```
 
## Getting Started
 
### What you need
 
- Node.js 18 or higher
- A Gemini API key (get one from Google AI Studio)
- A Firebase project
### Steps
 
1. Clone the repo
```bash
git clone https://github.com/PriyanshuVishwakarma912/LectureLens-Capstone-Project.git
cd LectureLens-Capstone-Project
```
 
2. Install packages
```bash
npm install
```
 
3. Set up environment variables
```bash
cp .env.example .env
```
 
   Open `.env` and add your keys (for example, your Gemini API key).
 
4. Add your Firebase settings in `firebase-applet-config.json`.
5. Start the app
```bash
npm run dev
```
 
6. Open the link shown in the terminal.
## Scripts
 
| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the app in development |
| `npm run build` | Build the app for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | Check TypeScript errors |
 
## How It Works
 
1. You paste a YouTube link.
2. The server gets the video content.
3. Gemini reads the content and writes notes.
4. The notes show on screen and are saved to your account.
5. You can download the notes as a PDF.
## Security
 
- Secret keys are kept in `.env` and are not pushed to GitHub.
- Firestore rules make sure users can only see their own data. See `security_spec.md` for details.
