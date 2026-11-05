---
name: Margo sign-in branding
description: Distinguishes app-owned branding from hosted Replit or third-party OAuth consent branding.
---

Replit Auth consent screens are hosted outside the app. The web app's own branding and artifact title do not directly control a provider-hosted OAuth consent label; that label is tied to the OAuth application's provider configuration. The Replit project title is renamed from the editor title control.

**Why:** The user requested the Margo name on every sign-in surface, but these surfaces have different owners and configuration paths.

**How to apply:** Update the Margo app's visible login screen and metadata in code. For the Replit project name or external OAuth consent branding, use the appropriate Replit editor or Users & Auth settings rather than styling the app.
