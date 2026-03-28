const { GoogleAuth } = require('google-auth-library');
const { OAuth2Client } = require('google-auth-library');
const http = require('http');
const url = require('url');

const MERCHANT_ID    = '6278355';
const DEVELOPER_EMAIL = 'alliedsafeandvaultco@gmail.com';
const CLIENT_ID      = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET  = process.env.OAUTH_CLIENT_SECRET;
const REDIRECT_URI   = 'urn:ietf:wg:oauth:2.0:oob';

async function register() {
  const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  // Generate the auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/content'],
  });

  console.log('\n=== ACTION REQUIRED ===');
  console.log('1. Open this URL in your browser:');
  console.log('\n' + authUrl + '\n');
  console.log('2. Sign in with your GMC Admin Google account');
  console.log('3. Copy the authorization code shown');
  console.log('4. Add it as a GitHub Secret named OAUTH_CODE');
  console.log('5. Re-run this workflow');
  console.log('======================\n');

  // If we have an auth code, exchange it and register
  const authCode = process.env.OAUTH_CODE;
  if (!authCode) {
    console.log('No OAUTH_CODE secret found yet. Complete the steps above first.');
    process.exit(0);
  }

  console.log('Auth code found — exchanging for token...');
  const { tokens } = await oauth2Client.getToken(authCode);
  oauth2Client.setCredentials(tokens);

  const accessToken = tokens.access_token;
  console.log('Token obtained successfully.');

  // Now call registerGcp with this token
  const registerUrl = `https://merchantapi.googleapis.com/accounts/v1/accounts/${MERCHANT_ID}/developerRegistration:registerGcp`;

  const res = await fetch(registerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ developerEmail: DEVELOPER_EMAIL }),
  });

  const data = await res.json();
  console.log('\nResponse status:', res.status);
  console.log('Response body:', JSON.stringify(data, null, 2));

  if (res.ok) {
    console.log('\n✓ Registration successful!');
    console.log('Wait 5 minutes then run the main GMC Monitor workflow.');
    console.log('You can now delete register.js, register.yml and the OAUTH_CODE secret.');
  } else {
    console.log('\n✗ Registration failed. See response above.');
  }
}

register().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
