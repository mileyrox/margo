# Chrome Web Store listing for Margo

Copy each part into the matching box in the Chrome Web Store Developer Dashboard.

## Store listing tab
**Name:** Margo: cheaper swaps

**Summary (132 characters max):**
Click Margo on a product page to find a cheaper version that does the same job. Only runs when you click it.

**Description:**
Margo finds cheaper versions of the things you already buy.

On a product page at Amazon, Target, Walmart, Ulta or most other stores, click the Margo icon. Margo reads the product you're looking at and suggests one cheaper option that does the same job: a store brand, or a well-known dupe with the same size and form. You see both side by side, how much you'd save, and why they're similar.

How it works
- Only runs when you click the icon. It doesn't watch your browsing.
- Reads only the product on the page: name, brand, price and barcode.
- Every swap is saved to your Swaps tab in the Margo app.

You need a free Margo account. In the app, go to Settings, then Chrome extension, and tap "Get a connection code." Paste it into the extension once.

Swaps are AI suggestions, so check the label and price before you buy. Some links earn Margo a commission, including as an Amazon Associate. It never costs you extra.

**Category:** Shopping
**Language:** English (United States)
**Store icon:** icons/icon128.png from the extension folder
**Screenshots (1280x800):** store-screenshot-1.png, store-screenshot-2.png
**Small promo tile (440x280):** store-promo-tile.png
**Official URL / Homepage:** your Margo app address
**Support URL:** mailto:miley@margomoney.co (or your app address)

## Privacy practices tab
**Single purpose:**
When the user clicks the Margo icon on a product page, find a cheaper alternative product and show it to them.

**Permission justifications:**
- activeTab: Lets Margo read the product on the current page only after the user clicks the icon.
- scripting: Runs a small script on that page, only on click, to read the product name, brand, price and barcode.
- storage: Saves the user's connection to their own Margo account on their device.
- Host permission (optional, https): Asked for once when the user connects, and only for their Margo account's address, so the extension can request swaps.

**Remote code:** No, I am not using remote code.

**Data usage (check these):**
- Website content: yes (the product name, brand, price and barcode of the page the user clicks Margo on).
- Everything else (personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity): no.

**Certify all three:**
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://<your app address>/privacy

## Distribution tab
- Visibility: start with **Unlisted** so only people with the link can install it (good for friend testing). Switch to **Public** when you're ready.
- Regions: United States.
