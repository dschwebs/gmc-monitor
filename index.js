/**
 * GMC Daily Morning Report
 *
 * Runs every morning at 7:00 AM and emails a summary of all
 * disapproved products in Google Merchant Center.
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

const REPORTS_BASE  = `https://merchantapi.googleapis.com/reports/v1/accounts/${MERCHANT_ID}`;
const PRODUCTS_BASE = `https://merchantapi.googleapis.com/products/v1/accounts/${MERCHANT_ID}`;

// Issue codes/phrases for "product page unavailable"
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
  const url   = `${REPORTS_BASE}/reports:search`;
  const query = `SELECT offer_id, id, title FROM product_view WHERE aggregated_reporting_context_status = 'NOT_ELIGIBLE_OR_DISAPPROVED'`;
  let results = [];
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
    const code   = (issue.code || '').toLowerCase();
    const desc   = (issue.description || '').toLowerCase();
    const detail = (issue.detail || '').toLowerCase();
    return (
      PAGE_UNAVAILABLE_CODES.some(c => code.includes(c)) ||
      PAGE_UNAVAILABLE_PHRASES.some(p => desc.includes(p) || detail.includes(p))
    );
  });
}

// ── Email ─────────────────────────────────────────────────────────────────────
async function sendDailyReport(affected, totalDisapproved) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_FROM, pass: EMAIL_PASS },
  });

  const count   = affected.length;
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  // Status line based on count
  let statusLine;
  if (count === 0) {
    statusLine = '✅ No "Product Page Unavailable" errors found today.';
  } else if (count < 50) {
    statusLine = `⚠️ ${count} product${count !== 1 ? 's' : ''} flagged with "Product Page Unavailable" errors.`;
  } else {
    statusLine = `🚨 ${count} products flagged with "Product Page Unavailable" errors — action may be needed.`;
  }

  const productList = count > 0
    ? affected.slice(0, 100)
        .map((p, i) => `  ${i + 1}. [${p.offerId}]  ${p.title}`)
        .join('\n')
    : '  None';

  const overflow = count > 100
    ? `\n  ... and ${count - 100} more (showing first 100)\n`
    : '';

  const subject = count === 0
    ? `✅ GMC Daily Report — ${dateStr} — No errors`
    : `${count < 50 ? '⚠️' : '🚨'} GMC Daily Report — ${dateStr} — ${count} page unavailable errors`;

  const text = `
GMC Daily Morning Report — Safe and Vault Store
Merchant ID : ${MERCHANT_ID}
Date        : ${dateStr}
Run time    : ${now.toUTCString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${statusLine}
Total disapproved/not-eligible products: ${totalDisapproved}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Products with "Page Unavailable" errors (${count}):
${productList}${overflow}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To request a manual website check:
https://merchants.google.com/mc/products/diagnostics

—
GMC Daily Report — gmc-monitor GitHub Action
`.trim();

  await transporter.sendMail({
    from: `"GMC Monitor" <${EMAIL_FROM}>`,
    to: EMAIL_TO,
    subject,
    text,
  });

  console.log(`  ✓ Daily report emailed to ${EMAIL_TO}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== GMC Daily Report — ${new Date().toUTCString()} ===`);

  // Validate env vars
  const required = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'EMAIL_FROM', 'EMAIL_TO', 'EMAIL_PASS'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

  // 1. Auth
  console.log('\n[1/3] Authenticating...');
  const token = await getAccessToken();
  console.log('  ✓ Authenticated');

  // 2. Get all disapproved products
  console.log('\n[2/3] Fetching disapproved products...');
  const disapproved = await getDisapprovedProducts(token);
  console.log(`  Found ${disapproved.length} disapproved/not-eligible products total`);

  // 3. Filter to page-unavailable issues specifically
  console.log('\n[3/3] Checking for "page unavailable" issues...');
  const affected = [];

  for (const product of disapproved) {
    if (!product.id) continue;
    const hasIssue = await hasPageUnavailableIssue(token, product.id);
    if (hasIssue) {
      affected.push(product);
      console.log(`  ✗ ${product.offerId} — ${product.title}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n  → ${affected.length} product(s) with page unavailable errors`);

  // Always send the daily report regardless of count
  await sendDailyReport(affected, disapproved.length);

  console.log(`\n=== Report complete ===\n`);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err.message);
  process.exit(1);
});
