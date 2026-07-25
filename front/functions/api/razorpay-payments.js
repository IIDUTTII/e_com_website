// functions/api/razorpay-payments.js
export async function onRequest(context) {
  const { request, env } = context;

  // ─── CORS ───
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    // ─── Auth ───
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const idToken = authHeader.split(' ')[1];

    // Verify Firebase token
    const user = await verifyFirebaseToken(idToken, env);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
    }

    // Check if user is admin/superadmin
    const role = await getUserRole(user.localId, env, idToken);
    if (!['admin', 'superadmin'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403 });
    }

    // ─── Get pagination params ───
    const url = new URL(request.url);
    const count = parseInt(url.searchParams.get('count')) || 20;
    const skip = parseInt(url.searchParams.get('skip')) || 0;

    // ─── Fetch from Razorpay API ───
    const rzpAuth = 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const rzpRes = await fetch(`https://api.razorpay.com/v1/payments?count=${count}&skip=${skip}`, {
      headers: { 'Authorization': rzpAuth },
    });

    if (!rzpRes.ok) {
      const err = await rzpRes.text();
      return new Response(JSON.stringify({ error: `Razorpay API error: ${err}` }), { status: rzpRes.status });
    }

    const data = await rzpRes.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    console.error('razorpay-payments error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

// ─── HELPERS ───

async function verifyFirebaseToken(idToken, env) {
  const apiKey = env?.FIREBASE_API_KEY || 'AIzaSyABec4VYQBnHpyzP1IX4TmW8muY3_VQHDM';
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error('❌ verifyFirebaseToken failed:', res.status, errorText);
    return null;
  }
  const data = await res.json();
  return data.users?.[0] || null;
}

async function getUserRole(uid, env, idToken) {
  try {
    const firebaseProjectId = env?.FIREBASE_PROJECT_ID || 'pahadse-13309';
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/users/${uid}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${idToken}` },
    });
    if (!res.ok) return 'user';
    const data = await res.json();
    return data.fields?.role?.stringValue || 'user';
  } catch (e) {
    return 'user';
  }
}

async function getServiceAccountToken(env) {
  const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;

  function base64url(str) {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const keyBuffer = pemToArrayBuffer(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const signatureBytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < signatureBytes.length; i++) binary += String.fromCharCode(signatureBytes[i]);
  const encodedSignature = base64url(binary);
  const jwt = `${signingInput}.${encodedSignature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Service account auth failed');
  return data.access_token;
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}