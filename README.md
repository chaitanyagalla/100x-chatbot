# Chaitanya — AI Interview Voice Bot

A voice bot that answers interview questions the way I, Galla Chaitanya, would answer them. Built for **Stage 1 (at-home assessment) of the 100x AI Agent Team interview**.

**Live demo:** _URL will be added here after deployment._

No account, installation, or API key is needed to use it. Open the link and start talking.

## How to use it

1. Open the link in **Chrome or Edge** on a computer or phone.
2. Tap the **orange face** (right, "You") and allow the microphone when the browser asks.
3. Ask your question. Orange lines pulse while it listens.
4. Tap the orange face **again** when you have finished. Your question is sent.
5. Lines pulse around the **green face** (left, "Chaitanya") while the answer is prepared and then read aloud. The question and answer also appear as text in the middle of the page.
6. Tap the green face to stop the audio, or to hear the last answer again.

Prefer typing, or using Firefox? Type into the box at the bottom and press **Send**. Everything else works the same.

### Questions to try

- What should we know about your life story in a few sentences?
- What's your #1 superpower?
- What are the top 3 areas you'd like to grow in?
- What misconception do your coworkers have about you?
- How do you push your boundaries and limits?
- What's your tech stack? / Tell me about a project you're working on.

Follow-up questions work too ("Can you tell me more about that?"): the bot remembers the last three exchanges.

## What the bot knows

All personal answers come from [lib/candidate-profile.ts](lib/candidate-profile.ts). It contains only facts I supplied myself, taken from my own answers and my resume:

- background: EEE graduate (2024) who moved into software through an interest in programming;
- about a year as a Full Stack Developer at Skill High (April 2025 – March 2026);
- current focus: AI agentic engineering (Job Scout Agent) and backend engineering (Flash Tix, a microservices ticket booking project);
- projects, skills, and achievements;
- my answers to the five assessment questions.

The bot is told to use only these facts. If it is asked about something not in the profile, it should say it hasn't been given that detail rather than make something up. Like any language model it can still make mistakes, so the page says so.

Contact details are deliberately not in the profile, because the bot is public.

## How it works

```text
Browser (Next.js page)
  speech recognition turns the spoken question into text
        |
        |  POST /api/chat  { question, recent history }
        v
Next.js API route (server)
  validates the request, adds my profile and instructions,
  calls the NVIDIA model with the server-side API key
        |
        v
Browser
  shows the answer and reads it aloud with speech synthesis
```

- **Frontend:** Next.js (App Router), React, TypeScript, plain CSS. The faces are inline SVG.
- **Voice:** the browser's built-in Web Speech API for both listening and speaking. No extra speech service or key.
- **AI:** [NVIDIA Build](https://build.nvidia.com/) chat API, default model `nvidia/nemotron-3.5-lightning-30b-a3b`.
- **Security:** the API key lives only in a server environment variable and is never sent to the browser. Requests are size-limited, validated, time-limited, and rate-limited (10 per minute per server instance).
- **Privacy:** nothing is saved. Refreshing the page clears the conversation. The browser's speech service may process the audio; the question text is sent to NVIDIA to generate the answer.

## Browser support

| Browser | Voice questions | Spoken answers | Typing |
| --- | --- | --- | --- |
| Chrome, Edge (desktop and Android) | Yes | Yes | Yes |
| Safari | Partly | Yes | Yes |
| Firefox | No | Yes | Yes |

Voice quality depends on the voices installed in the browser. Edge's "Natural" voices sound the most human.

## Run it yourself

Requires Node.js 24.

```powershell
npm ci
copy .env.example .env.local   # then put your key in NVIDIA_API_KEY
npm run dev
```

Open <http://localhost:3000>. Get a free key from [NVIDIA Build](https://build.nvidia.com/). Optionally set `NVIDIA_MODEL` to another available model.

Checks:

```powershell
npm run typecheck
npm test
npm run build
```

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by the execution policy. The scripts use Webpack, so Next.js can fall back to its WebAssembly compiler where the native one is blocked.

## Deploying

The app is designed for [Vercel](https://vercel.com/): import the GitHub repository, add `NVIDIA_API_KEY` as an environment variable, and deploy. No other configuration is needed.
