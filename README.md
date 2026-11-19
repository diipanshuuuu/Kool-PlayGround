# Kool PlayGround

A minimal, distraction-free, bring-your-own-key (BYOK) LLM playground inspired by Groq Playground. Test prompts across multiple model providers with full sampling controls, live prompt shot-type detection, web search grounding, and client-only API key management.

## Features

- **Flexible BYOK API Key Vault**
  - Supports **Groq**, **OpenAI**, **Anthropic**, **OpenRouter**, and any **Custom OpenAI-Compatible** endpoint (e.g., Together, Fireworks, DeepSeek, Ollama), plus a **Built-in Sandbox** mode.
  - **Session-only mode (default)**: API keys stay strictly in browser memory and clear automatically on page refresh or when you click **End session**.
  - **Local browser storage mode**: Opt in to persist keys in your browser's `localStorage` across visits, switch modes per provider, or clear individual/all keys at any time.
  - **Stateless key verification**: Optional connection check against the selected provider without storing or logging credentials on any server.
- **Advanced Parameter Controls & Presets**
  - Paired sliders and numeric inputs for **Temperature**, **Top P**, **Max Completion Tokens**, **Frequency Penalty**, **Presence Penalty**, **Seed**, **Stop Sequences**, and **Reasoning Effort** (on supported models).
  - One-click **Precise**, **Balanced**, and **Creative** sampling presets, plus a live workspace parameter readout and per-response parameter stamps so you can compare how settings affect output.
- **Live Prompt Shot-Type & Token Indicator**
  - Real-time input token estimate paired with automatic **Zero-shot**, **One-shot**, and **Few-shot** classification directly in the composer bar (accounting for demonstrations in both the user prompt and system prompt).
- **Browser Search Grounding**
  - Toggle **Browser Search** to use native web search on supported models (`openai/gpt-oss-*`, `groq/compound*`, Sandbox) or live web snippet grounding with numbered clickable source citations on any other model.
- **Developer Workflow Tools**
  - Collapsible **System Prompt** editor with live token estimate.
  - **JSON Mode** and **Streaming / Non-streaming** toggle with mid-stream **Stop** cancellation.
  - **View Code** exporter generating runnable `cURL`, `JavaScript`, and `Python` snippets with environment variable placeholders (never exporting raw keys).
  - **Saved Sessions** stored locally in your browser (without API keys), Markdown + GFM rendering with copyable code blocks, measured response timing (elapsed time, TTFT, tokens/sec), and **Light / Dark** themes.

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide icons, `react-markdown` + `remark-gfm`
- **Backend**: Express + Vite middleware (`server.ts`) providing a stateless BYOK streaming proxy, key verification route, live web search grounding, and optional server-side sandbox
- **Testing**: Node's built-in test runner (`node:test`) via `tsx`

## Getting Started

### Prerequisites

- Node.js 20+ (22+ recommended)
- npm

### Installation

```bash
git clone <your-repo-url>
cd <your-repo-directory>
npm install
```

### Environment Variables (Optional)

Copy `.env.example` to `.env` if you want to enable the optional Built-in Sandbox route or configure a custom app URL:

```bash
cp .env.example .env
```

> **Note:** You do **not** need any server `.env` keys to use Groq, OpenAI, Anthropic, OpenRouter, or Custom OpenAI-compatible endpoints—simply paste your API key directly in the **API Key Vault** inside the UI.

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production Build & Run

```bash
npm run build
NODE_ENV=production npm start
```

### Type Checking & Unit Tests

```bash
npm run lint
npm test
```

## Deploy to Firebase

This repository is pre-configured so you can clone it from GitHub and deploy straight to Firebase with no extra setup.

### Option 1: Firebase Hosting (Static — Free Spark Plan)

Best for instant, zero-cost deployment. When hosted statically on Firebase Hosting, Kool PlayGround automatically switches BYOK requests (**Groq**, **OpenAI**, **Anthropic**, **OpenRouter**, and CORS-enabled **Custom** endpoints) to direct browser-to-provider API calls—including key verification, streaming, sampling controls, JSON mode, and native Groq web search (`openai/gpt-oss-*` / `groq/compound*`).

```bash
git clone <your-repo-url>
cd <your-repo-directory>
npm install
npm install -g firebase-tools

firebase login
firebase use --add        # select your Firebase project
firebase deploy           # automatically runs `npm run build` and deploys dist/
```

Or deploy directly to a specific project ID in one command:

```bash
firebase deploy --only hosting --project <your-firebase-project-id>
```

### Option 2: Firebase App Hosting (Full-Stack Node.js)

Use **Firebase App Hosting** if you also want the Express `/api/*` backend for server-side web search grounding on non-native models and the optional Built-in Sandbox route:

1. Push this repository to GitHub (keep `apphosting.yaml`, `package.json`, and `server.ts`).
2. In the [Firebase Console](https://console.firebase.google.com/), open **App Hosting** and connect your GitHub repository.
3. *(Optional)* To enable the Built-in Sandbox route, store a Gemini API key secret and uncomment `GEMINI_API_KEY` in `apphosting.yaml`:
   ```bash
   firebase apphosting:secrets:set GEMINI_API_KEY
   ```

## Security & Privacy Model

- API keys entered in the UI are never written to a server database or logged to disk.
- **Session-only** keys live solely in React state and disappear immediately upon refreshing the tab or clicking **End session**.
- **Saved** keys are written only to your browser's `localStorage` and can be demoted to session-only or cleared at any time.
- Exported code snippets always substitute environment variable placeholders (`$GROQ_API_KEY`, `$OPENAI_API_KEY`, etc.).

## License

Apache-2.0
