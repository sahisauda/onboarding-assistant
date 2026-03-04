# Ranosys AI Deployment Guide

Follow these steps to deploy your application to a production environment (e.g., Render, Heroku, or a VPS).

## 1. Prerequisites
- A GitHub repository with this code.
- A Google Cloud Project with OAuth 2.0 credentials.
- A Groq or OpenAI API Key.

## 2. Environment Variables (.env)
You must set the following variables in your deployment platform's "Environment Variables" section:

| Variable | Description |
|----------|-------------|
| `PORT` | Set automatically by most providers (usually 3000 or 8080). |
| `SESSION_SECRET` | A long random string for session security. |
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID. |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret. |
| `GOOGLE_REDIRECT_URI` | **IMPORTANT**: This must match your production URL (e.g., `https://your-app.render.com/auth/google/callback`). |
| `GOOGLE_DRIVE_FOLDER_ID` | The fallback master folder ID for Admin browsing. |
| `OPENAI_API_KEY` | Your AI API Key (Groq or OpenAI). |
| `OPENAI_BASE_URL` | Set to `https://api.groq.com/openai/v1` for Groq. |
| `GROQ_MODEL_NAME` | e.g., `llama3-70b-8192`. |
| `PORTAL_URL` | Your production URL (e.g., `https://your-app.render.com`). Used for email links. |
| `ADMIN_EMAIL` | The email of the master administrator. |

## 3. Google OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Update your "Authorized redirect URIs" to include:
   - `https://your-app.render.com/auth/google/callback`
3. Update "Authorized JavaScript origins" to include:
   - `https://your-app.render.com`

## 4. Deployment Steps (Render.com Example)
1. **New > Web Service**.
2. Connect your GitHub repository.
3. **Environment**: Select `Node`.
4. **Build Command**: `npm install`.
5. **Start Command**: `npm start`.
6. Add all strictly required variables from your `.env` to the "Environment Variables" tab.
7. Click **Deploy**.

## 5. User Onboarding
Once deployed:
1. Log in with your Ranosys Admin account.
2. Open **"Context Settings"** in the sidebar.
3. You will see the **"Deployment Center"** section below the standard settings.
4. Verify your Folder ID and add employee emails.
5. Click **"Share Access & Invite"**. They will receive an email and can log in to start using the AI immediately.
