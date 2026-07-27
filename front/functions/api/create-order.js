// functions/api/create-order.js
import { calculateOrder } from '../lib/orderCalculator.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return handleCORS();
  if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405);

  try {
    const body = await request.json();
  
    console.log('📦 Full request body:', JSON.stringify(body, null, 2));
    const { items, address, paymentMethod, couponCode } = body;

    // Auth
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return errorResponse('Unauthorized', 401);
    const idToken = authHeader.split(' ')[1];

    const user = await verifyFirebaseToken(idToken, env);
    if (!user) return errorResponse('Invalid token', 401);
    const userId = user.localId;

    // Validate payment method
    if (!['online', 'cod'].includes(paymentMethod)) {
      return errorResponse('Invalid payment method', 400);
    }
    
    console.log('📥 Address received in worker:', JSON.stringify(address, null, 2));
    // Validate address
    const addrErrors = validateAddress(address);
    if (addrErrors.length > 0) {
      return errorResponse(`Invalid address: ${addrErrors.join(', ')}`, 400);
    }

    // Server-side calculation (validates stock, prices, active flags)
    const calc = await calculateOrder(items, userId, idToken, env, couponCode);

    // Secure order ID
    const orderId = `order_${crypto.randomUUID().slice(0, 8)}`;

    // Build order data
    const orderData = {
      userId,
      customerName: address.fullName?.trim() || 'Customer',
      phone: address.phone?.trim() || '',
      address: `${address.streetAddress}, ${address.city}, ${address.state || ''} - ${address.pincode}`,
      items: calc.items,
      subtotal: calc.subtotal,
      shippingCost: calc.shipping,
      couponCode: couponCode || null,
      couponDiscount: calc.discount,
      refund_status: null,
      refund_amount: 0,
      refund_reason: null,
      refund_requested_by: null,
      refund_approved_by: null,
      refunded_at: null,
      amount: calc.total,
      paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'pending_collection' : 'pending',
      shippingStatus: 'pending',
      trackingId: 'PENDING_DISPATCH',
      createdAt: new Date(),
      updatedAt: new Date(),
      stockReduced: false,
      orderId: orderId, // store orderId as a field for query fallback
    };

    const firebaseProjectId = env.FIREBASE_PROJECT_ID;
    const razorpayKeyId = env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = env.RAZORPAY_KEY_SECRET;

    if (!firebaseProjectId || !razorpayKeyId || !razorpayKeySecret) {
      console.error('create-order: missing required env (FIREBASE_PROJECT_ID / RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
      return new Response(JSON.stringify({
        error: 'Payment processor is temporarily unavailable. Please try again shortly.',
        errorStage: 'config_missing',
        orderId: null,
      }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // ─── 1. CREATE ORDER DOCUMENT WITH SPECIFIC ID ───
    const createUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/orders?documentId=${orderId}`;
    console.log('📤 Creating order at URL:', createUrl);
    console.log('📤 Order data:', JSON.stringify(orderData, null, 2));

    // Convert to Firestore fields
    const fields = {};
    for (const [key, value] of Object.entries(orderData)) {
      fields[key] = convertToFirestoreFields(value);
    }

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ fields }),
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      console.error('❌ Order creation failed:', createRes.status, errorText);
      throw new Error(`Order creation failed: ${errorText}`);
    }
    console.log('✅ Order created successfully with ID:', orderId);

    // ─── 2. CLEAR CART (only for COD) ───
    if (paymentMethod === 'cod') {
      const cartUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/carts/${userId}`;
      const cartRes = await fetch(cartUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ fields: { items: { arrayValue: { values: [] } } } }),
      });
      if (!cartRes.ok) {
        console.warn('⚠️ Cart clear failed (non-critical):', await cartRes.text());
      } else {
        console.log('✅ Cart cleared for COD order');
      }
    }

    // ─── 3. CREATE RAZORPAY ORDER (only for online) ───
    let razorpayOrder = null;
    if (paymentMethod === 'online') {
      const rzpAuth = 'Basic ' + btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
      const rzpBody = {
        amount: Math.round(calc.total * 100),
        currency: 'INR',
        receipt: orderId,
        notes: { orderId, userId }
      };
      console.log('💰 Creating Razorpay order:', rzpBody);
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Authorization': rzpAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify(rzpBody),
      });
      razorpayOrder = await rzpRes.json();
      if (razorpayOrder.error) {
        console.error('❌ Razorpay order creation failed:', razorpayOrder.error);
        return errorResponse(`Razorpay error: ${razorpayOrder.error.description}`, 400);
      }
      console.log('✅ Razorpay order created:', razorpayOrder.id);

      // Store razorpay_order_id in order document (merge — updateMask required so existing fields are not wiped)
      const updateUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/orders/${orderId}`;
      const updateMask = ['razorpayOrderId', 'updatedAt'].map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
      const updateRes = await fetch(`${updateUrl}?${updateMask}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          fields: {
            razorpayOrderId: { stringValue: razorpayOrder.id },
            updatedAt: { timestampValue: new Date().toISOString() }
          }
        }),
      });
      if (!updateRes.ok) {
        console.warn('⚠️ Failed to store razorpayOrderId (non-critical):', await updateRes.text());
      } else {
        console.log('✅ Razorpay order ID stored in Firestore');
      }
    }

    // ─── 4. RETURN SUCCESS ───
    return new Response(JSON.stringify({
      success: true,
      orderId,
      razorpayOrder,
      razorpayKey: razorpayKeyId,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    console.error('❌ create-order error:', err);
    return errorResponse(err.message, 500);
  }
}

// ─── HELPERS ───

function validateAddress(addr) {
  const errors = [];
  if (!addr?.fullName?.trim()) errors.push('fullName required');
  if (!addr?.streetAddress?.trim()) errors.push('streetAddress required');
  if (!addr?.city?.trim()) errors.push('city required');
  if (!addr?.state?.trim()) errors.push('state required');
  if (!addr?.pincode?.trim() || !/^\d{6}$/.test(addr.pincode.trim())) errors.push('valid 6-digit pincode required');
  const phoneClean = addr?.phone?.trim().replace(/\D/g, '');
  if (!phoneClean || !/^\d{10}$/.test(phoneClean)) errors.push('valid 10-digit phone required');
  return errors;
}

function handleCORS() {
  return new Response(null, { headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function errorResponse(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

async function verifyFirebaseToken(idToken, env) {
  const apiKey = env?.FIREBASE_API_KEY || 'AIzaSyABec4VYQBnHpyzP1IX4TmW8muY3_VQHDM';
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error('❌ verifyFirebaseToken failed:', res.status, errorText);
    return null;
  }
  const data = await res.json();
  return data.users?.[0] || null;
}

function convertToFirestoreFields(obj) {
  if (obj === null || obj === undefined) return { nullValue: null };
  if (typeof obj === 'string') return { stringValue: obj };
  if (typeof obj === 'number') {
    // Firestore REST expects integerValue as string
    if (Number.isInteger(obj)) return { integerValue: String(obj) };
    return { doubleValue: obj };
  }
  if (typeof obj === 'boolean') return { booleanValue: obj };
  if (Array.isArray(obj)) {
    return { arrayValue: { values: obj.map(v => convertToFirestoreFields(v)) } };
  }
  if (obj instanceof Date) {
    return { timestampValue: obj.toISOString() };
  }
  if (typeof obj === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
      fields[k] = convertToFirestoreFields(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(obj) };
}