---
name: Margo sign-in branding
description: Distinguishes app-owned Margo branding from third-party OAuth consent branding.
---

The web app's own branding and artifact title do not directly control a provider-hosted OAuth consent label; that label is tied to the OAuth application's provider configuration. Clerk app branding and custom OAuth credentials are configured separately from the app-owned sign-in screen.

**Why:** The user requested the Margo name on every sign-in surface, but these surfaces have different owners and configuration paths.

**How to apply:** Update the Margo app's visible login screen and metadata in code. For external OAuth consent branding, use the Auth pane's app branding and provider configuration rather than styling the app.
