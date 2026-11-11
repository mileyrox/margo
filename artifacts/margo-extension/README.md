# Margo Chrome extension

Click the Margo icon on a product page (Amazon, Target, Walmart or most other stores) and it finds a cheaper swap.
Nothing runs on a page until the icon is clicked.

## Try it on your computer (free)
1. Download this folder (or unzip `margo-extension.zip`).
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and pick this folder.
3. Pin Margo from the puzzle-piece menu.
4. In the Margo app, open **Settings > Chrome extension > Get a connection code**, copy it, click the Margo icon in Chrome and paste it.

## Publish to the Chrome Web Store
Create a Chrome Web Store developer account (one-time $5), upload `margo-extension.zip`, and add the privacy policy link (`/privacy` on the Margo site).
Review usually takes a few days.

## How it works
- `popup.js` reads the product name, brand, price and barcode from the page (only after the click), and sends them to Margo's `/api/extension/swap`.
- It signs in with its own token from Settings (90 days, removable anytime), never your Margo password.
- Permissions: `activeTab` and `scripting` (read the current page when clicked), `storage` (remember the connection), and access to your Margo address only, asked for when you connect.
