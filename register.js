const { GoogleAuth } = require('google-auth-library');

const MERCHANT_ID     = '6278355';
const DEVELOPER_EMAIL = 'dschwebs@safeandvaultstore.com';

async function register() {
  console.log('Authenticating with service account...');
  
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/content'],
  });
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  console.log('✓ Authenticated');

  const url = `https://merchantapi.googleapis.com/accounts/v1/accounts/${MERCHANT_ID}/developerRegistration:registerGcp`;

  console.log('Calling registerGcp...');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ developerEmail: DEVELOPER_EMAIL }),
  });

  const data = await res.json();
  console.log('Response status:', res.status);
  console.log('Response:', JSON.stringify(data, null, 2));

  if (res.ok) {
    console.log('\n✓ Registration successful! Wait 5 minutes then run the main workflow.');
  } else {
    console.log('\n✗ Registration failed.');
  }
}

register().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
