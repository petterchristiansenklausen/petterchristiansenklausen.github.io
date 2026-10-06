# Min Mat AI

Server-side AI endpoint for **Min Mat – kjøkken og matplan**.

- `GET /api/health`
- `POST /api/chef`
- Uses Vercel AI Gateway with Vercel OIDC, so no provider API key is embedded in the iOS app.
- The iOS app sends only the food inventory and the user's explicit AI-Chef preferences for the current request.
- Responses are structured JSON so the app can save recipes, add missing items to the shopping list, and add meals to the meal plan.
