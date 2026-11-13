import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { Seal } from '@/components/margo/art';

/**
 * Every legal page reads from here. Add the mailing address once there is one, and update the state and venue if the company is formed elsewhere.
 * Keep the drafts in the "Margo Legal Launch Kit" doc in sync, and have a lawyer review before launch.
 */
export const company = {
  legalName: 'Margo Money',
  state: 'Georgia',
  venue: 'Fulton County, Georgia',
  address: '',
  privacyEmail: 'miley@margomoney.co',
  supportEmail: 'miley@margomoney.co',
  effectiveDate: 'November 11, 2026',
  backupDays: 30,
};

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const { isSignedIn } = useAuth();
  return <main className="m-legal">
    <Link href={isSignedIn ? '/settings' : '/'} className="m-brand" aria-label="Back to Margo"><Seal size={30} /><span>Margo</span></Link>
    <article>
      <h1>{title}</h1>
      <p className="m-muted">Effective {company.effectiveDate}</p>
      {children}
    </article>
    <nav className="m-legal-links" aria-label="Legal">
      <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/disclosures">Disclosures</Link>
    </nav>
  </main>;
}

const Contact = () => <p>{company.legalName}{company.address ? `, ${company.address}` : ''}, <a href={`mailto:${company.privacyEmail}`}>{company.privacyEmail}</a></p>;

export function PrivacyPage() {
  return <LegalPage title="Privacy Policy">
    <p>Margo is a budgeting app run by {company.legalName} ("Margo," "we," "us"). This policy explains what we collect, why, who we share it with, and the choices you have. The short version: we use your information to run your budget and find you cheaper swaps. We never sell your personal information, and we can never move your money.</p>

    <h2>What we collect</h2>
    <h3>Information you give us</h3>
    <ul>
      <li><strong>Account details:</strong> your name, email address, and profile picture from the sign-in service you use.</li>
      <li><strong>Setup answers:</strong> take-home pay, savings goal, bills such as rent, car, phone, pets and debt, the things you never want to swap, and the categories you are open to swapping.</li>
      <li><strong>Purchases you add:</strong> amounts, categories, dates and notes you enter yourself.</li>
      <li><strong>Receipt photos and barcodes:</strong> images you upload or take, and the store, items and prices we read from them.</li>
      <li><strong>Preferences:</strong> your avatar, swaps you save or switch to, votes on swaps, and your tax set-aside rate.</li>
    </ul>
    <h3>Information from your bank, through Plaid</h3>
    <p>If you choose to connect a bank or card, we use Plaid Inc. ("Plaid") to do it. You sign in to your bank inside Plaid's window. Margo never sees or stores your bank username or password. With your permission, Plaid shares account names, balances and transactions (merchant, amount, date and category) with us. We keep a daily copy of each account's balance so Margo can show money that actually moved into savings and how your debts are going down. Interest rates and minimum payments you type in are saved with your debt plan. By connecting an account you agree to Plaid's collection and use of your information under the <a href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noreferrer">Plaid End User Privacy Policy</a>.</p>
    <h3>The Margo browser extension</h3>
    <p>If you install the Margo Chrome extension, it reads the product on the page you're viewing (its name, brand, price and barcode) only when you click the Margo icon, and sends that to Margo to find a swap. It does not read other pages, your browsing history or anything you type. It connects with its own code that you can remove anytime in Settings.</p>
    <h3>Emails you forward to Margo</h3>
    <p>You can forward order and receipt emails to your private Margo address, or set up a forwarding rule in your email. We only receive emails sent to that address. We read the store, date, total and items from each one, save that as a receipt, and do not keep the email itself. If an email isn't a receipt, we skip it. You can make a new address anytime in Settings, which turns off the old one.</p>
    <h3>Information collected automatically</h3>
    <p>We use a sign-in cookie to keep you logged in. Our servers keep basic logs such as request times and error details to keep the app running and secure. We do not use advertising trackers.</p>

    <h2>How we use it</h2>
    <ul>
      <li>To build and update your budget, track spending, and flag deposits that may need a tax set-aside.</li>
      <li>To read receipts and barcodes and find cheaper products or dupes for things you buy.</li>
      <li>To show your debt payoff progress, savings and avatar unlocks.</li>
      <li>To keep Margo secure, fix problems and improve features.</li>
      <li>To contact you about your account or important changes. We will only send marketing emails if you opt in.</li>
    </ul>
    <p>Tax set-aside amounts and swap suggestions are estimates to help you plan. They are not tax, legal or investment advice.</p>

    <h2>Who we share it with</h2>
    <p>We share information only as needed to run Margo:</p>
    <ul>
      <li><strong>Plaid</strong>, to connect your accounts.</li>
      <li><strong>Clerk</strong>, which runs sign-in and keeps your account secure.</li>
      <li><strong>Hosting, database and storage providers</strong> that run Margo for us.</li>
      <li><strong>Product databases and web search</strong> (such as Open Food Facts, Open Beauty Facts and UPCitemdb) to identify products and find photos. We send only a product name or barcode, never who you are or anything about your money.</li>
      <li><strong>Postmark</strong>, which receives emails you forward to your private Margo receipt address and passes them to us. Margo reads the receipt from the email and does not keep the email itself.</li>
      <li><strong>Skimlinks</strong>, an affiliate network. When you tap a link to a store other than Amazon, it passes through Skimlinks first so the store knows Margo sent you. Skimlinks sees that click (like your device and IP address), not your name or your money. See <a href="https://skimlinks.com/privacy-policies/" target="_blank" rel="noreferrer">Skimlinks' privacy policy</a>.</li>
      <li><strong>AI service providers</strong> that read receipt images, search the web for swaps and help write swap explanations (currently OpenAI, through our hosting provider Replit). We send only what the task needs and do not allow them to use it to train their models where we can control that setting.</li>
      <li><strong>Authorities</strong>, if the law requires it or to protect someone's safety or rights.</li>
      <li><strong>A buyer or successor</strong>, if Margo is merged or sold. They must follow this policy.</li>
    </ul>
    <p>When you tap a store or affiliate link, you leave Margo. That store may set its own cookies to credit us with a commission. We do not send your budget, bank data or identity to stores.</p>
    <p><strong>We do not sell or rent your personal information</strong>, and we do not share your bank data with advertisers or data brokers.</p>

    <h2>How we protect it</h2>
    <ul>
      <li>Connections to Margo are encrypted in transit.</li>
      <li>The keys that let us read your bank data are encrypted at rest and never sent to your browser.</li>
      <li>Access to production data is limited to people who need it to run Margo.</li>
      <li>Margo cannot move money, make payments or open accounts in your name.</li>
    </ul>
    <p>No system is perfectly secure. If a breach affects your information, we will notify you and authorities as the law requires.</p>

    <h2>How long we keep it</h2>
    <p>We keep your information while your account is active. If you delete your data in Settings, we remove your transactions, receipts, budgets, preferences and bank connections from our active systems right away, and from backups within {company.backupDays} days. We may keep limited records when the law requires it.</p>

    <h2>Your choices</h2>
    <ul>
      <li><strong>Disconnect a bank</strong> at any time in Settings. You can also revoke access through your bank or at <a href="https://my.plaid.com" target="_blank" rel="noreferrer">my.plaid.com</a>.</li>
      <li><strong>Download your data</strong> in Settings.</li>
      <li><strong>Delete your data</strong> in Settings, or email <a href={`mailto:${company.privacyEmail}`}>{company.privacyEmail}</a>.</li>
      <li><strong>Opt out of marketing emails</strong> with the link in any email.</li>
    </ul>
    <p>Depending on where you live, you may have extra rights, such as asking what we hold about you, correcting it, or deleting it. Email {company.privacyEmail} and we will respond within the time your state's law requires. We will not treat you differently for using these rights.</p>

    <h2>Children</h2>
    <p>Margo is for people 18 and older. We do not knowingly collect information from anyone under 18. If you think a minor has signed up, email {company.privacyEmail} and we will delete the account.</p>

    <h2>Changes</h2>
    <p>If we make important changes, we will tell you in the app or by email before they take effect. The date at the top shows when this policy last changed.</p>

    <h2>Contact</h2>
    <Contact />
  </LegalPage>;
}

export function TermsPage() {
  return <LegalPage title="Terms of Use">
    <p>These terms are an agreement between you and {company.legalName} ("Margo," "we," "us"). By creating an account or using Margo, you agree to them and to our <Link href="/privacy">Privacy Policy</Link>. If you don't agree, please don't use Margo.</p>

    <h2>1. Who can use Margo</h2>
    <p>You must be at least 18 and live in the United States. You are responsible for keeping your sign-in secure and for activity on your account.</p>

    <h2>2. What Margo is, and isn't</h2>
    <p>Margo helps you budget, track spending, and find cheaper products. Margo is a tool for your own planning.</p>
    <ul>
      <li><strong>Not financial, tax, legal or investment advice.</strong> Budgets, tax set-aside amounts, debt payoff dates and swap savings are estimates based on the information you and your bank provide. Check important decisions with a qualified professional.</li>
      <li><strong>Not a bank.</strong> Margo does not hold, move or transfer money, and cannot make payments for you.</li>
      <li><strong>Not a guarantee.</strong> We can't promise any amount of savings, or that a tax estimate matches what you will owe.</li>
    </ul>

    <h2>3. Connecting your accounts</h2>
    <p>You can connect bank and card accounts through Plaid. You authorize Margo and Plaid to access your account information for Margo to work, as described in the Privacy Policy. Your bank's data may be delayed, incomplete or categorized incorrectly. You can disconnect at any time in Settings.</p>

    <h2>4. Swaps, prices and links</h2>
    <ul>
      <li>Swaps are suggestions. "Dupe" means two products share key features or ingredients, not that they are identical. Check labels, ingredients and allergens yourself, especially for food, skincare and health products.</li>
      <li>Prices and availability change and may differ by store or location. Check the price before you buy.</li>
      <li>Products are sold by third-party stores, not Margo. Your purchase is between you and that store, under its terms.</li>
      <li>Some links are affiliate links. We may earn a commission if you buy, at no extra cost to you. See our <Link href="/disclosures">Affiliate Disclosure</Link>.</li>
      <li>Brand names belong to their owners. Mentioning a brand doesn't mean it endorses Margo or the swap.</li>
    </ul>

    <h2>5. Your content</h2>
    <p>You keep ownership of what you add, like receipts and notes. You give us permission to store and process it to run Margo for you. If you vote on or rate swaps, we may use those votes, without your name, to improve swaps for everyone.</p>

    <h2>6. Acceptable use</h2>
    <p>Don't misuse Margo. That includes accessing other people's accounts or data, scraping or copying the app or its swap catalog, reverse engineering it, uploading anything illegal or harmful, or interfering with how it runs.</p>

    <h2>7. Fees</h2>
    <p>Margo is free right now. If we add paid features, we will tell you the price before you are charged, and you can choose whether to pay.</p>

    <h2>8. Ending your account</h2>
    <p>You can stop using Margo and delete your data in Settings at any time. We may suspend or close accounts that break these terms or put others at risk.</p>

    <h2>9. Disclaimers</h2>
    <p>Margo is provided "as is" and "as available." To the extent the law allows, we disclaim all warranties, including that Margo will be error-free, uninterrupted or accurate.</p>

    <h2>10. Limitation of liability</h2>
    <p>To the extent the law allows, Margo is not liable for indirect, incidental or consequential damages, or for lost money or savings, arising from your use of Margo. Our total liability for any claim is limited to the greater of what you paid us in the last 12 months or $50.</p>

    <h2>11. Disputes</h2>
    <p>These terms are governed by the laws of {company.state}, without regard to conflict-of-law rules. Disputes will be handled in the state or federal courts in {company.venue}, unless your local law gives you the right to bring a claim where you live.</p>

    <h2>12. Changes</h2>
    <p>We may update these terms. If a change is important, we will tell you in the app or by email before it takes effect. Using Margo after that means you accept the new terms.</p>

    <h2>13. Contact</h2>
    <p>{company.legalName}{company.address ? `, ${company.address}` : ''}, <a href={`mailto:${company.supportEmail}`}>{company.supportEmail}</a></p>
  </LegalPage>;
}

export function DisclosuresPage() {
  return <LegalPage title="Affiliate Disclosure">
    <p>Margo is free to use. To keep it that way, some links in Margo are affiliate or referral links. If you tap one and buy something or sign up, Margo may earn a commission or bonus. It never costs you extra.</p>
    <ul>
      <li><strong>Swaps are ranked for you, not for us.</strong> We pick swaps based on price, size and how similar the products are. Whether a store pays us does not change which swap we show or how we describe it.</li>
      <li><strong>We mark paid links.</strong> Any link that may earn us money is labeled in the app.</li>
      <li><strong>Money apps are ones we've used.</strong> Every app on the Money apps page has been used by Margo's founder. Some links there are referral links that pay us a bonus.</li>
      <li><strong>Amazon.</strong> As an Amazon Associate I earn from qualifying purchases.</li>
      <li><strong>Other stores.</strong> Links to stores like Target, Walmart and Ulta go through Skimlinks, an affiliate network, which may pay Margo a commission.</li>
    </ul>
    <h2>Where swap information comes from</h2>
    <p>Margo suggests swaps by comparing product facts like type, size and key ingredients, using AI and public product data. "Dupe" means two products share key features, not that they are identical or made by the same company. Brand names are used only to identify products and belong to their owners. Barcode product details come from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> and Open Beauty Facts, available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">Open Database License</a>.</p>
    <p>Questions? Email <a href={`mailto:${company.supportEmail}`}>{company.supportEmail}</a>.</p>
  </LegalPage>;
}
