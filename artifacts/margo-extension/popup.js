// Margo Chrome extension: click the icon on a product page to find a cheaper swap.
// Nothing runs on pages until the icon is clicked (the "activeTab" permission).

const view = document.getElementById('view');
const menu = document.getElementById('menu');

/** Small DOM helper. Text always goes in as text, never as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child.nodeType ? child : String(child));
  return el;
}
const show = (...nodes) => view.replaceChildren(...nodes);
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);

/* ---------- Connecting to a Margo account ---------- */
async function getConnection() {
  const { margo } = await chrome.storage.local.get('margo');
  return margo && margo.u && margo.t ? margo : null;
}

function parseCode(raw) {
  try {
    const text = raw.trim().replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(atob(text + '='.repeat((4 - (text.length % 4)) % 4)));
    const url = new URL(data.u);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    if (typeof data.t !== 'string' || data.t.length < 20) return null;
    return { u: url.origin + url.pathname.replace(/\/$/, ''), t: data.t };
  } catch { return null; }
}

function connectScreen(message) {
  const code = h('textarea', { rows: 4, placeholder: 'Paste your code here', 'aria-label': 'Connection code' });
  const error = h('p', { class: 'error', role: 'alert' }, message || '');
  const button = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const parsed = parseCode(code.value);
    if (!parsed) { error.textContent = "That code doesn't look right. Copy it again from Margo's Settings."; return; }
    // Ask Chrome for permission to talk to this Margo address only.
    const granted = await chrome.permissions.request({ origins: [new URL(parsed.u).origin + '/*'] });
    if (!granted) { error.textContent = 'Margo needs that permission to look up swaps.'; return; }
    await chrome.storage.local.set({ margo: parsed });
    start();
  } }, 'Connect');
  menu.hidden = true;
  show(
    h('h1', {}, 'Connect your Margo account'),
    h('p', { class: 'muted' }, 'In the Margo app, go to Settings, then Chrome extension, and tap "Get a connection code." Paste it here.'),
    code, error, button,
  );
}

/* ---------- Reading the product on the page ---------- */
// Runs inside the shopping page, only when the icon is clicked. Returns plain data.
function readProductOnPage() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/\d+(\.\d{1,2})?/); return m ? Number(m[0]) : null; };
  const pick = (...selectors) => { for (const sel of selectors) { const el = document.querySelector(sel); const text = el && clean(el.content || el.textContent); if (text) return text; } return ''; };
  let name = '', brand = '', price = null, barcode = '', image = '';
  // Structured product data most stores publish for search engines.
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const items = [].concat(JSON.parse(script.textContent));
      const all = items.flatMap((item) => item && item['@graph'] ? item['@graph'] : [item]);
      const product = all.find((item) => item && /Product/i.test([].concat(item['@type']).join(' ')));
      if (product) {
        name = name || clean(product.name);
        brand = brand || clean(typeof product.brand === 'string' ? product.brand : product.brand && product.brand.name);
        barcode = barcode || String(product.gtin13 || product.gtin12 || product.gtin || product.upc || '').replace(/\D/g, '');
        const offer = [].concat(product.offers || [])[0];
        price = price ?? num(offer && (offer.price || offer.lowPrice));
        image = image || [].concat(product.image || [])[0] || '';
        if (typeof image === 'object') image = image.url || '';
      }
    } catch { /* not valid JSON, skip */ }
  }
  const host = location.hostname;
  if (/amazon\./.test(host)) {
    name = pick('#productTitle') || name;
    brand = brand || pick('#bylineInfo').replace(/^(Visit the |Brand: )/, '').replace(/ Store$/, '');
    price = price ?? num(pick('#corePrice_feature_div .a-offscreen', '.a-price .a-offscreen'));
  } else if (/target\.com$/.test(host)) {
    name = name || pick('[data-test="product-title"]', 'h1');
    price = price ?? num(pick('[data-test="product-price"]'));
  } else if (/walmart\.com$/.test(host)) {
    name = name || pick('h1[itemprop="name"]', 'h1');
    price = price ?? num(pick('[itemprop="price"]', '[data-testid="price-wrap"] span'));
  }
  name = name || pick('meta[property="og:title"]', 'h1');
  const retailer = /amazon\./.test(host) ? 'Amazon' : /target\.com$/.test(host) ? 'Target' : /walmart\.com$/.test(host) ? 'Walmart' : host.replace(/^www\./, '');
  return { name: name.slice(0, 200), brand: brand.slice(0, 120), price, barcode: barcode.slice(0, 14), image: String(image).slice(0, 500), retailer };
}

async function readProduct() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:/.test(tab.url || '')) return null;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readProductOnPage });
    return result && result.result && (result.result.name || result.result.barcode) ? result.result : null;
  } catch { return null; }
}

/* ---------- Finding the swap ---------- */
function photo(url, label) {
  const box = h('span', { class: 'photo' });
  if (url && /^https:/.test(url)) {
    const img = h('img', { src: url, alt: label, referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => box.replaceChildren(h('span', {}, label)));
    box.append(img);
  } else box.append(h('span', {}, label));
  return box;
}

function result(data, product, conn) {
  const item = data.suggestions && data.suggestions[0];
  if (!item) {
    return show(h('h1', {}, 'No swap this time'), h('p', { class: 'muted' }, `I didn't find a swap I'm confident in for ${product.name}. It may already be a good deal.`));
  }
  const fromPrice = product.price || data.price;
  const saved = fromPrice && item.typicalPrice != null ? fromPrice - item.typicalPrice : null;
  const amazon = /amazon/i.test(item.retailer || '') || /amazon\./i.test(item.url || '');
  const store = amazon ? 'Amazon' : item.retailer || 'the store';
  const toBrand = item.brand || item.name;
  show(
    h('h1', {}, 'A cheaper swap'),
    h('div', { class: 'card' },
      h('div', { class: 'pair' },
        h('div', { class: 'tile' }, photo(product.image || data.imageUrl, data.brand || product.brand || 'This item'), h('b', {}, data.brand || product.brand || 'This item'), fromPrice ? h('small', { class: 'price-old' }, money(fromPrice)) : null),
        saved != null && saved > 0.25
          ? h('div', { class: 'save' }, h('small', {}, 'Save'), h('b', {}, '$' + Math.round(saved)))
          : h('div', { class: 'save word' }, h('b', {}, item.matchType === 'Dupe' ? 'Dupe' : 'Costs less')),
        h('div', { class: 'tile' }, photo(item.imageUrl, toBrand), h('b', {}, toBrand), item.typicalPrice != null ? h('span', { class: 'price-new' }, (amazon ? '~' : '') + money(item.typicalPrice)) : null),
      ),
      h('p', {}, h('b', {}, item.name), item.sizeText ? `, ${item.sizeText}` : '', h('span', { class: 'muted' }, item.shortReason ? ` · ${item.shortReason}` : '')),
      item.whySimilar && item.whySimilar.length ? h('ul', { class: 'why' }, item.whySimilar.slice(0, 3).map((line) => h('li', {}, line))) : null,
      h('a', { class: 'btn', href: item.url, target: '_blank', rel: 'noreferrer sponsored' }, `Shop ${toBrand} on ${store} ↗`),
    ),
    h('div', { class: 'row' }, h('a', { class: 'link small', href: conn.u + '/swaps', target: '_blank' }, 'Saved to your Swaps in Margo')),
    h('p', { class: 'fine' }, 'Swaps are AI suggestions, so check the label and price. Prices marked ~ are typical prices from other stores. Some links earn Margo a commission, including as an Amazon Associate.'),
  );
}

async function findSwap(conn, product) {
  show(h('div', { class: 'row' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, 'Looking for a cheaper swap for ', h('b', {}, product.name || 'this product'), '…')));
  let response;
  try {
    response = await fetch(conn.u + '/api/extension/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + conn.t },
      body: JSON.stringify({ name: product.name, brand: product.brand, price: product.price, barcode: product.barcode, retailer: product.retailer }),
    });
  } catch {
    return show(h('h1', {}, "Couldn't reach Margo"), h('p', { class: 'muted' }, 'Check your connection and try again.'), h('button', { class: 'btn outline', type: 'button', onclick: () => findSwap(conn, product) }, 'Try again'));
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { await chrome.storage.local.remove('margo'); return connectScreen(data.error || 'Please connect again.'); }
  if (!response.ok) return show(h('h1', {}, 'Something went wrong'), h('p', { class: 'muted' }, data.error || 'Try again in a minute.'), h('button', { class: 'btn outline', type: 'button', onclick: () => findSwap(conn, product) }, 'Try again'));
  result(data, product, conn);
}

/* ---------- Start ---------- */
async function start() {
  const conn = await getConnection();
  if (!conn) return connectScreen();
  menu.hidden = false;
  const product = await readProduct();
  if (!product) {
    return show(h('h1', {}, 'Open a product page'), h('p', { class: 'muted' }, 'Go to a product on Amazon, Target, Walmart or another store, then click Margo again.'));
  }
  findSwap(conn, product);
}

menu.addEventListener('click', async () => {
  await chrome.storage.local.remove('margo');
  connectScreen('Disconnected. To connect again, paste a new code.');
});

start();
