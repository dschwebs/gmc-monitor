/**
 * GMC Monitor - Product Page Unavailable Auto-Fix
 *
 * Checks Google Merchant Center for "product page unavailable" errors
 * using the Merchant API v1. If errors are found, requests a website
 * review and sends an email notification.
 *
 * Merchant ID: 6278355
 */

const { GoogleAuth } = require('google-auth-library');
const nodemailer = require('nodemailer');

// ── Config ────────────────────────────────────────────────────────────────────
const MERCHANT_ID = process.env.MERCHANT_ID || '6278355';
const EMAIL_FROM  = process.env.EMAIL_FROM;  // alliedsafeandvaultco@gmail.com
const EMAIL_TO    = process.env.EMAIL_TO;    // dschwebs@safeandvaultstore.com
const EMAIL_PASS  = process.env.EMAIL_PASS;  // Gmail App Password (16-char)

// Issue codes/phrases used by Merchant API for "product page unavailable"
const PAGE_UNAVAILABLE_CODES = [
  'landing_page_error',
  'page_not_found',
  'product_page_unavailable',
];
const PAGE_UNAVAILABLE_PHRASES = [
  'page unavailable',
  'landing page',
  'page not found',
  'crawl error',
];

const ACCOUNTS_BASE = `https://merchantapi.googleapis.com/accounts/v1/accounts/${MERCHANT_ID}`;
const REPORTS_BASE  = `https://merchantapi.googleapis.com/reports/v1/accounts/${MERCHANT_ID}`;
const PRODUCTS_BASE = `https://merchantapi.googleapis.com/products/v1/accounts/${MERCHANT_ID}`;

// ── Auth ──────────────────────────────────────────────────────────────────────
async function getAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/content'],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

// ── API helpers ───────────────────────────────────────────────────────────────

/**
 * Query Reports API for all disapproved/not-eligible products.
 */
async function getDisapprovedProducts(token) {
  const url    = `${REPORTS_BASE}/reports:search`;
  const query  = `SELECT offer_id, id, title FROM product_view WHERE aggregated_reporting_context_status = 'NOT_ELIGIBLE_OR_DISAPPROVED'`;
  let results  = [];
  let pageToken;

  do {
    const body = { query };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Reports API ${res.status}: ${err}`);
    }

    const data = await res.json();
    results    = results.concat(data.results || []);
    pageToken  = data.nextPageToken;
  } while (pageToken);

  return results.map(r => ({
    offerId: r.productView?.offerId,
    title:   r.productView?.title || 'Unknown',
    id:      r.productView?.id,
  }));
}

/**
 * Fetch a single product and check if any itemLevelIssue matches
 * "product page unavailable".
 */
async function hasPageUnavailableIssue(token, productId) {
  const res = await fetch(`${PRODUCTS_BASE}/products/${productId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.warn(`  Skipping ${productId} — fetch returned ${res.status}`);
    return false;
  }

  const product = await res.json();
  const issues  = product.productStatus?.itemLevelIssues || [];

  return issues.some(issue => {
    const code = (issue.code || '').toLowerCase();
    const desc = (issue.description || '').toLowerCase();
    const detail = (issue.detail || '').toLowerCase();
    return (
      PAGE_UNAVAILABLE_CODES.some(c => code.includes(c)) ||
      PAGE_UNAVAILABLE_PHRASES.some(p => desc.includes(p) || detail.includes(p))
    );
  });
}

/**
 * Request a website review. Tries the homepage claim endpoint first,
 * then falls back to re-enabling programs (which triggers a re-crawl).
 */
async function requestWebsiteReview(token) {
  // Primary: homepage claim
  const claimRes = await fetch(`${ACCOUNTS_BASE}/homepage:claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (claimRes.ok) {
    console.log('  ✓ Website review requested via homepage claim.');
    return;
  }

  console.warn(`  Homepage claim returned ${claimRes.status} — trying programs fallback...`);

  // Fallback: re-enable Shopping Ads + Free Listings
  for (const program of ['shopping-ads', 'free-listings']) {
    const progRes = await fetch(`${ACCOUNTS_BASE}/programs/${program}:enable`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (progRes.ok) {
      console.log(`  ✓ Review triggered via program re-enable: ${program}`);
    } else {
      const err = await progRes.text();
      console.warn(`  Program ${program} returned ${progRes.status}: ${err}`);
    }
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────
async function sendEmail(affected) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_FROM, pass: EMAIL_PASS },
  });

  const count       = affected.length;
  const displayList = affected.slice(0, 50)
    .map(p => `  • [${p.offerId}]  ${p.title}`)
    .join('\n');
  const overflow = count > 50 ? `\n  ... and ${count - 50} more (showing first 50)\n` : '';

  const subject = `⚠️ GMC Monitor: ${count} product${count !== 1 ? 's' : ''} flagged "Page Unavailable" — review requested`;

  const text = `
GMC Monitor — Safe and Vault Store
Merchant ID : ${MERCHANT_ID}
Run time    : ${new Date().toUTCString()}

${count} product${count !== 1 ? 's' : ''} ${count !== 1 ? 'were' : 'was'} found with "Product Page Unavailable"
errors in Google Merchant Center.

A website review has been automatically requested.
Google typically clears these within 12–24 hours.

Affected products:
${displayList}${overflow}

—
Automated message from your GMC Monitor GitHub Action (gmc-monitor repo).
Disable the workflow there if you no longer need these alerts.
`.trim();

  await transporter.sendMail({
    from: `"GMC Monitor" <${EMAIL_FROM}>`,
    to: EMAIL_TO,
    subject,
    text,
  });

  console.log(`  ✓ Email sent to ${EMAIL_TO}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== GMC Monitor — ${new Date().toUTCString()} ===`);

  // Validate env vars
  const required = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'EMAIL_FROM', 'EMAIL_TO', 'EMAIL_PASS'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

  // 1. Auth
  console.log('\n[1/4] Authenticating...');
  const token = await getAccessToken();
  console.log('  ✓ Authenticated');

  // 2. Get all disapproved products
  console.log('\n[2/4] Fetching disapproved products from Merchant API...');
  const disapproved = await getDisapprovedProducts(token);
  console.log(`  Found ${disapproved.length} disapproved/not-eligible products`);

  if (disapproved.length === 0) {
    console.log('\nNo issues found. Nothing to do. ✓');
    return;
  }

  // 3. Filter to page-unavailable issues specifically
  console.log(`\n[3/4] Checking each product for "page unavailable" issues...`);
  const affected = [];

  for (const product of disapproved) {
    if (!product.id) continue;
    const hasIssue = await hasPageUnavailableIssue(token, product.id);
    if (hasIssue) {
      affected.push(product);
      console.log(`  ✗ ${product.offerId} — ${product.title}`);
    }
    // Small delay to be respectful of rate limits
    await new Promise(r => setTimeout(r, 150));
  }

  if (affected.length === 0) {
    console.log('  No "page unavailable" issues found specifically. Nothing to do. ✓');
    return;
  }

  console.log(`\n  → ${affected.length} product(s) affected`);

  // 4. Request review + notify
  console.log('\n[4/4] Requesting website review and sending email...');
  await requestWebsiteReview(token);
  await sendEmail(affected);

  console.log(`\n=== Complete: ${affected.length} products flagged, review requested ===\n`);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err.message);
  process.exit(1);
});
