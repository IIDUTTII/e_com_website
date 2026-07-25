<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { db, auth } from '../firebase.js'
import { doc, getDoc } from 'firebase/firestore'
import { fetchShippingConfig, fetchCart, createOrderSecure, fetchCartItemsStock } from './db.js'

defineOptions({ name: 'Checkout' })
const router = useRouter()

const cartItems = ref([])
const loading = ref(true)
const userAccountData = ref(null)
const processingOrder = ref(false)
const isCodGloballyActive = ref(true)
const selectedAddressId = ref('')
const selectedPaymentMethod = ref('online')
const appliedPromoCode = ref(window.sessionStorage.getItem('active_promo_code') || null)
const appliedPromoDiscount = ref(Number(window.sessionStorage.getItem('active_promo_discount')) || 0)
const shippingConfig = ref({ fee: 60, freeThreshold: 499, isFreeShippingActive: true })
const stockMap = ref(new Map())
const stockLoading = ref(false)

async function refreshStock() {
  if (!cartItems.value.length) { stockMap.value = new Map(); return }
  stockLoading.value = true
  try {
    stockMap.value = await fetchCartItemsStock(cartItems.value)
  } catch (e) { console.warn('Stock refresh failed:', e) }
  finally { stockLoading.value = false }
}

function getItemStockInfo(item) {
  const key = `${item.productId}::${item.variant || item.weight || 'Standard'}`
  return stockMap.value.get(key) || null
}

function isItemOutOfStock(item) {
  const info = getItemStockInfo(item)
  if (!info) return false
  return info.stock === 0 || !info.isActive || !info.variantActive
}

function getStockLabel(item) {
  const info = getItemStockInfo(item)
  if (!info) return ''
  if (!info.isActive) return 'Unavailable'
  if (!info.variantActive) return 'Variant Unavailable'
  if (info.stock === 0) return 'Out of Stock'
  if (info.stock < item.quantity) return `Only ${info.stock} left`
  return ''
}

const hasOutOfStockItems = computed(() => cartItems.value.some(item => isItemOutOfStock(item)))

onMounted(() => {
  const script = document.createElement('script')
  script.src = 'https://checkout.razorpay.com/v1/checkout.js'
  document.body.appendChild(script)

  auth.onAuthStateChanged(async (user) => {
    if (!user) { router.push('/login'); return }
    
    try {
      cartItems.value = await fetchCart();
      if (cartItems.value.length === 0) { router.push('/'); return; }

      // Fetch live stock for all cart items
      await refreshStock()

      const userSnap = await getDoc(doc(db, 'users', user.uid))
      if (userSnap.exists()) {
        userAccountData.value = userSnap.data()
        const addresses = userSnap.data().addresses || []
        if (addresses.length > 0 && !selectedAddressId.value) selectedAddressId.value = addresses[0].id
      }

      const configSnap = await getDoc(doc(db, 'systemConfig', 'gateways'))
      if (configSnap.exists()) isCodGloballyActive.value = configSnap.data().isCodActive
      
      const shipCfg = await fetchShippingConfig()
      if (shipCfg) shippingConfig.value = shipCfg

    } catch (e) { console.warn(e.message) }
    finally { loading.value = false }
  })
})

// These computed values are now **only for UI display** – not used in backend requests.
const subtotal = computed(() => cartItems.value.reduce((s, i) => s + i.price * i.quantity, 0))
const shippingCost = computed(() => {
  if (subtotal.value === 0) return 0
  if (shippingConfig.value.isFreeShippingActive && subtotal.value >= shippingConfig.value.freeThreshold) return 0
  return Number(shippingConfig.value.fee) || 0
})
const grandTotal = computed(() => Math.max(subtotal.value - appliedPromoDiscount.value + shippingCost.value, 0))
const activeAddressesList = computed(() => userAccountData.value?.addresses || [])
const activeSelectedAddressObject = computed(() => activeAddressesList.value.find(a => a.id === selectedAddressId.value))
const routeToProfileAddressManager = () => router.push('/user')

// ─────────────────────────────────────────────────────────────
// OPEN RAZORPAY MODAL – receives only the minimal payload
// ─────────────────────────────────────────────────────────────
const openRazorpayModal = async (orderPayload) => {
  try {
    // orderPayload already has: items, address, paymentMethod, couponCode
    const data = await createOrderSecure(orderPayload);
    

    if (!data.razorpayOrder || !data.razorpayOrder.id) {
      throw new Error("Invalid Razorpay Order ID from backend");
    }

    const orderData = data.razorpayOrder;
    const orderId = data.orderId;

    const options = {
      key: data.razorpayKey || import.meta.env.VITE_RAZORPAY_KEY_ID,
      amount: orderData.amount,
      currency: "INR",
      name: "PahadS",
      description: "Mountain Harvest Provisions",
      order_id: orderData.id,
      handler: async function (paymentResponse) {
        try {
          processingOrder.value = true;

          const idToken = await auth.currentUser.getIdToken(true);

          const verifyRes = await fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`   // ✅ Added
            },
            body: JSON.stringify({
              razorpay_order_id: paymentResponse.razorpay_order_id,
              razorpay_payment_id: paymentResponse.razorpay_payment_id,
              razorpay_signature: paymentResponse.razorpay_signature,
              orderId: orderId,
            })
          });

          if (!verifyRes.ok) {
            const err = await verifyRes.json();
            const debugSuffix = err.debugId ? `\nDebug ID: ${err.debugId}` : '';
            const stageSuffix = err.errorStage ? ` [${err.errorStage}]` : '';
            throw new Error(`${stageSuffix} ${err.error || "Payment verification failed."}${debugSuffix}`);
          }

          window.sessionStorage.removeItem('active_promo_discount');
          window.sessionStorage.removeItem('active_promo_code');

          alert(`Payment Successful! Order ID: ${orderId}`);
          router.push('/user');

        } catch (err) {
          alert("Error: " + err.message);
          processingOrder.value = false;
        }
      },
      prefill: {
        name: orderPayload.address.fullName,
        email: auth.currentUser?.email || "",
        contact: orderPayload.address.phone
      },
      theme: { color: "#16a34a" },
      modal: {
        ondismiss: function() { processingOrder.value = false; }
      }
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', function (paymentResponse){
      processingOrder.value = false;
      alert("Payment Failed: " + paymentResponse.error.description);
    });
    rzp.open();

  } catch (error) {
    alert("Could not start Razorpay: " + error.message);
    processingOrder.value = false;
  }
};

// ─────────────────────────────────────────────────────────────
// PROCESS CHECKOUT SUBMISSION – now sends only essential data
// ─────────────────────────────────────────────────────────────
const processCheckoutSubmission = async () => {
  if (!activeSelectedAddressObject.value) { 
    alert("Please choose a valid destination route address."); 
    return; 
  }
  processingOrder.value = true;

  const target = activeSelectedAddressObject.value;

  // 🔧 Build address with explicit string conversion
  const address = {
    fullName: String(target.fullName || '').trim(),
    streetAddress: String(target.streetAddress || '').trim(),
    city: String(target.city || '').trim(),
    state: String(target.state || '').trim(),
    pincode: String(target.pincode || '').trim(),
    phone: String(target.phone || '').trim(),
  };

  // 🧪 Debug: Log the address to verify
  console.log('📤 Sending address:', address);

  const itemsPayload = cartItems.value.map(i => ({
    productId: i.productId,
    variant: i.variant || i.weight || 'Standard Option',
    variantId: i.variantId || i.variant || i.weight || 'Standard Option',
    quantity: i.quantity
  }));

  const basePayload = {
    items: itemsPayload,
    address: address,  // ✅ use the validated address
    paymentMethod: selectedPaymentMethod.value,
    couponCode: appliedPromoCode.value,
  };

  try {
    if (selectedPaymentMethod.value === 'online') {
      if (confirm("Proceed to Razorpay gateway?")) {
        await openRazorpayModal(basePayload);
      } else {
        processingOrder.value = false;
      }
    } else {
      const data = await createOrderSecure(basePayload);
      window.sessionStorage.removeItem('active_promo_discount');
      window.sessionStorage.removeItem('active_promo_code');
      alert(`COD Order Registered! Order ID: ${data.orderId}`);
      router.push('/user');
    }
  } catch (error) {
    alert("Operation aborted: " + error.message);
    processingOrder.value = false;
  }
};
</script>


<template>
  <div class="seamless-checkout-page">
    <div v-if="loading" class="center-loading-state"><div class="spinner"></div></div>

    <div v-else class="checkout-split-layout fade-in">
      
      <main class="checkout-form-side">
        <div class="form-content-wrapper">
          
          <h1 class="page-main-title">Checkout</h1>

          <section class="checkout-section">
            <div class="section-header">
              <h2>Shipping Address</h2>
              <button class="text-action-btn" @click="routeToProfileAddressManager">Add / Edit</button>
            </div>

            <div class="address-grid">
              <div v-if="activeAddressesList.length === 0" class="empty-address-box">
                <p>No addresses found.</p>
                <button class="btn-dark-outline" @click="routeToProfileAddressManager">Add Address</button>
              </div>
              
              <label 
                v-for="addr in activeAddressesList" :key="addr.id" 
                :class="['address-tile', { 'is-selected': selectedAddressId === addr.id }]"
              >
                <div class="tile-radio">
                  <input type="radio" v-model="selectedAddressId" :value="addr.id" />
                </div>
                <div class="tile-content">
                  <div class="tile-header">
                    <strong>{{ addr.fullName }}</strong>
                    <span class="addr-tag">{{ addr.label }}</span>
                  </div>
                  <p class="tile-address">{{ addr.streetAddress }}, {{ addr.city }}, {{ addr.state }} - {{ addr.pincode }}</p>
                  <span class="tile-phone">{{ addr.phone }}</span>
                </div>
              </label>
            </div>
          </section>

          <section class="checkout-section">
            <div class="section-header">
              <h2>Payment Method</h2>
            </div>
            
            <div class="payment-group">
              <label :class="['payment-tile', { 'is-selected': selectedPaymentMethod === 'online' }]">
                <div class="tile-radio">
                  <input type="radio" v-model="selectedPaymentMethod" value="online" name="payment_lane" />
                </div>
                <div class="tile-content">
                  <div class="payment-title-row">
                    <strong>Pay Online</strong>
                    <span class="test-badge">Test Mode</span>
                  </div>
                  <p>Razorpay (UPI, Cards, NetBanking)</p>
                </div>
              </label>

              <label :class="['payment-tile', { 'is-selected': selectedPaymentMethod === 'cod', 'is-disabled': !isCodGloballyActive }]">
                <div class="tile-radio">
                  <input type="radio" v-model="selectedPaymentMethod" value="cod" :disabled="!isCodGloballyActive" name="payment_lane" />
                </div>
                <div class="tile-content">
                  <strong>Cash on Delivery (COD)</strong>
                  <p v-if="isCodGloballyActive">Pay when you receive the package.</p>
                  <p v-else class="error-text">COD is currently unavailable in your region.</p>
                </div>
              </label>
            </div>
          </section>
          
          <div class="mobile-only-checkout-btn">
            <button @click="processCheckoutSubmission" :disabled="processingOrder || cartItems.length === 0" class="btn-primary-large">
              {{ processingOrder ? 'Processing...' : selectedPaymentMethod === 'cod' ? 'Confirm COD Order' : 'Pay Now' }}
            </button>
          </div>

        </div>
      </main>

      <aside class="checkout-summary-side">
        <div class="summary-content-wrapper">
          
          <!-- Out of Stock Warning Banner -->
          <div v-if="hasOutOfStockItems" class="oos-warning-banner">
            <span>⚠️</span>
            <p><strong>Some items are out of stock.</strong> Please remove them before placing your order to avoid errors.</p>
          </div>

          <div class="basket-items-list">
            <div v-for="(item, idx) in cartItems" :key="idx" :class="['summary-item-row', { 'oos-item-row': isItemOutOfStock(item) }]">
              <div class="item-left">
                <div class="thumb"><img v-if="item.imageUrl" :src="item.imageUrl" /><span v-else>{{ item.emoji || '🍯' }}</span></div>
                <div class="info">
                  <strong>{{ item.name }}</strong>
                  <span>{{ item.variant || item.weight || 'Standard' }}</span>
                  <span v-if="getStockLabel(item)" :class="['stock-badge-checkout', { 'oos': isItemOutOfStock(item), 'low': !isItemOutOfStock(item) }]">
                    {{ getStockLabel(item) }}
                  </span>
                  <span class="qty">{{ item.quantity }} × ₹{{ item.price }} = ₹{{ item.price * item.quantity }}</span>
                </div>
              </div>
              <span class="price">₹{{ item.price * item.quantity }}</span>
            </div>
          </div>

          <div class="ledger-section">
            <div class="ledger-row">
              <span>Subtotal</span>
              <span>₹{{ subtotal }}</span>
            </div>
            
            <div v-if="appliedPromoCode" class="ledger-row highlight-green">
              <span>Discount ({{ appliedPromoCode }})</span>
              <span>-₹{{ appliedPromoDiscount }}</span>
            </div>

            <div class="ledger-row">
              <span>Shipping</span>
              <span v-if="shippingCost === 0" class="highlight-green">Free</span>
              <span v-else>₹{{ shippingCost }}</span>
            </div>
          </div>

          <div class="ledger-total">
            <span>Total</span>
            <span class="total-amount">
              <span class="currency-code">INR</span> ₹{{ grandTotal }}
            </span>
          </div>

          <div class="inline-warning">
            <span>⚠️</span>
            <p><strong>Test Mode Active:</strong> This is a testing environment. No real payments will be processed. Use test card details for Razorpay.</p>
          </div>

          <div class="desktop-only-checkout-btn">
            <button @click="processCheckoutSubmission" :disabled="processingOrder || cartItems.length === 0" class="btn-primary-large">
              {{ processingOrder ? 'Processing...' : selectedPaymentMethod === 'cod' ? 'Confirm COD Order' : 'Pay Now' }}
            </button>
          </div>

        </div>
      </aside>

    </div>
  </div>
</template>

<style scoped>
.seamless-checkout-page{background:#faf7f4;min-height:100vh;font-family:'Jost',sans-serif;color:#1a1a2e;padding-top:80px}
.checkout-split-layout{display:flex;min-height:calc(100vh - 80px);gap:24px;max-width:1200px;margin:0 auto}
.checkout-form-side{flex:1.2;background:#ffffff;display:flex;justify-content:flex-start;padding:32px 40px 60px 40px;border-radius:12px}
.checkout-summary-side{flex:0.8;background:#ffffff;display:flex;justify-content:flex-start;padding:32px 40px 60px 40px;border-radius:12px}
.form-content-wrapper{width:100%;max-width:100%}
.summary-content-wrapper{width:100%;max-width:100%}
.center-loading-state{display:flex;justify-content:center;align-items:center;height:60vh}
.spinner{width:36px;height:36px;border:3px solid #ede8e2;border-top-color:#16a34a;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.fade-in{animation:fIn 0.3s ease}
@keyframes fIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.page-main-title{font-family:'Inter',sans-serif;font-size:1.5rem;font-weight:700;margin:0 0 24px 0;color:#1a1a2e;letter-spacing:-0.3px;text-align:left}
.checkout-section{margin-bottom:28px}
.section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.section-header h2{font-size:0.85rem;font-weight:600;margin:0;color:#6b5f55;text-transform:uppercase;letter-spacing:0.4px;text-align:left}
.text-action-btn{background:none;border:none;color:#16a34a;font-weight:600;font-size:0.8rem;cursor:pointer;padding:0;transition:color 0.2s}
.text-action-btn:hover{color:#0e7a34}
.address-grid{display:flex;flex-direction:column;gap:4px;width:100%}
.address-tile{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;background:#faf7f4;border-radius:6px;border:1px solid transparent;transition:all 0.15s;width:100%;box-sizing:border-box}
.address-tile:hover{background:#f0ebe6;border-color:#d4ccc4}
.address-tile.is-selected{background:#f0fdf4;border-color:#16a34a}
.tile-radio{flex-shrink:0;padding-top:0}
.tile-radio input{width:15px;height:15px;accent-color:#16a34a;cursor:pointer}
.tile-content{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px}
.tile-header{display:flex;align-items:center;gap:6px}
.tile-header strong{font-size:0.85rem;color:#1a1a2e;font-weight:600}
.addr-tag{font-size:0.5rem;background:#ede8e2;color:#5a4f45;padding:1px 8px;border-radius:100px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;flex-shrink:0}
.tile-address{font-size:0.8rem;color:#6b5f55;margin:0}
.tile-phone{font-size:0.75rem;color:#1a1a2e;font-weight:600}
.payment-group{display:grid;grid-template-columns:1fr 1fr;gap:6px;width:100%}
.payment-tile{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;background:#faf7f4;border-radius:6px;border:1px solid transparent;transition:all 0.15s;width:100%;box-sizing:border-box}
.payment-tile:hover{background:#f0ebe6;border-color:#d4ccc4}
.payment-tile.is-selected{background:#f0fdf4;border-color:#16a34a}
.payment-title-row{display:flex;flex-direction:column;width:100%}
.payment-title-row strong{font-size:0.85rem;color:#1a1a2e;font-weight:600}
.payment-title-row p{font-size:0.72rem;color:#6b5f55;margin:1px 0 0}
.payment-title-row .error-text{color:#dc2626!important;font-weight:600}
.is-disabled{opacity:0.5;cursor:not-allowed;background:#f5f0eb!important}
.is-disabled:hover{background:#f5f0eb!important;border-color:transparent!important}
.test-badge{background:#fef3c7;color:#92400e;font-size:0.5rem;font-weight:700;padding:1px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.3px;display:inline-block;margin-top:1px}
.empty-address-box{padding:14px;text-align:center;color:#6b5f55;background:#faf7f4;border-radius:6px;border:1px dashed #d4ccc4;width:100%;box-sizing:border-box}
.btn-dark-outline{background:transparent;border:1px solid #1a1a2e;color:#1a1a2e;padding:5px 16px;border-radius:6px;font-weight:600;font-size:0.8rem;cursor:pointer;transition:all 0.2s}
.btn-dark-outline:hover{background:#1a1a2e;color:#fff}

/* ─── SUMMARY ITEMS ─── */
.basket-items-list{display:flex;flex-direction:column;gap:6px;margin-bottom:18px;max-height:320px;overflow-y:auto;padding-right:4px;width:100%}
.basket-items-list::-webkit-scrollbar{width:4px}
.basket-items-list::-webkit-scrollbar-track{background:#ede8e2;border-radius:10px}
.basket-items-list::-webkit-scrollbar-thumb{background:#c4b8ae;border-radius:10px}
.summary-item-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #ede8e2;width:100%}
.summary-item-row:last-child{border-bottom:none}
.item-left{display:flex;align-items:center;gap:12px}
.thumb{width:48px;height:48px;background:#fff;border:1px solid #ede8e2;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.thumb img{width:100%;height:100%;object-fit:cover}
.thumb span{font-size:1.5rem}
.info{display:flex;flex-direction:column}
.info strong{font-size:.95rem;font-weight:600;color:#1a1a2e}
.info span{font-size:.8rem;color:#6b5f55}
.info .qty{font-size:.82rem;color:#5a4f45;margin-top:2px;font-weight:500}
.price{font-size:1rem;font-weight:700;color:#1a1a2e}

/* ─── Out of Stock Indicators (Checkout) ─── */
.oos-warning-banner{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:.82rem;color:#991b1b;line-height:1.4;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px;width:100%;box-sizing:border-box}
.oos-warning-banner span{font-size:.95rem;flex-shrink:0}
.oos-warning-banner p{margin:0}
.stock-badge-checkout{font-size:0.6rem;font-weight:700;padding:1px 7px;border-radius:100px;display:inline-block;text-transform:uppercase;letter-spacing:0.3px;margin-top:2px}
.stock-badge-checkout.oos{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
.stock-badge-checkout.low{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.oos-item-row{opacity:0.65;background:#fefbfb;border-left:3px solid #dc2626;padding-left:8px}
.oos-item-row .info strong{color:#9a8a7a;text-decoration:line-through}
.oos-item-row .price{color:#9a8a7a;text-decoration:line-through}

/* ─── LEDGER ─── */
.ledger-section{border-top:1px solid #ede8e2;border-bottom:1px solid #ede8e2;padding:14px 0;margin-bottom:16px;display:flex;flex-direction:column;gap:6px;width:100%}
.ledger-row{display:flex;justify-content:space-between;font-size:.9rem;color:#5a4f45;padding:2px 0;width:100%}
.highlight-green{color:#16a34a;font-weight:600}
.ledger-total{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;width:100%}
.ledger-total>span:first-child{font-size:1rem;font-weight:700;color:#1a1a2e}
.total-amount{font-size:1.4rem;font-weight:800;color:#1a1a2e;display:flex;align-items:baseline;gap:4px}
.currency-code{font-size:.75rem;color:#6b5f55;font-weight:600}

/* ─── WARNING ─── */
.inline-warning{background:#fefae0;border:1px solid #f5e0b0;border-radius:8px;padding:10px 14px;font-size:.82rem;color:#7a6535;line-height:1.4;margin-bottom:16px;display:flex;align-items:flex-start;gap:10px;width:100%;box-sizing:border-box}
.inline-warning span{font-size:.95rem;flex-shrink:0}
.inline-warning p{margin:0}

/* ─── BUTTON ─── */
.btn-primary-large{width:100%;padding:14px;background:#1a1a2e;color:#fff;border:none;border-radius:10px;font-size:.95rem;font-weight:700;cursor:pointer;transition:all .25s;box-sizing:border-box}
.btn-primary-large:hover:not(:disabled){background:#16a34a;transform:translateY(-2px);box-shadow:0 6px 20px rgba(22,163,74,0.2)}
.btn-primary-large:disabled{opacity:.5;cursor:not-allowed;transform:none}
.mobile-only-checkout-btn{display:none;margin-top:20px}
.desktop-only-checkout-btn{display:block}

@media(max-width:900px){.checkout-split-layout{flex-direction:column;gap:16px}.checkout-form-side,.checkout-summary-side{justify-content:flex-start;padding:20px 20px 40px 20px}.checkout-summary-side{order:1}.checkout-form-side{order:2}.desktop-only-checkout-btn{display:none}.mobile-only-checkout-btn{display:block}.page-main-title{display:none}.payment-group{grid-template-columns:1fr}}
</style>