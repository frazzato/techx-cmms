# Tech X CMMS v20 — Copilot

Complete v19 application with Tech X Copilot added.

## Deploy
1. Copy `.env.example` to your environment settings; do not commit real passwords.
2. Set `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_NAME` in Vercel.
3. Deploy the repository.

## Copilot
The new `#/copilot` page is a guided prompt workspace. It does not call an AI API. It can copy a live aggregate CMMS snapshot with the selected question and open Microsoft Copilot in a separate tab. Review data and follow company privacy policy before pasting it into external services.
