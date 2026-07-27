<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { db, auth } from '../firebase.js'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { saveCartItems, fetchCoupons, fetchShippingConfig, fetchLiveCartItems } from './db.js'

defineOptions({ name: 'CartView' })

const cartItems = ref([]), liveItems = ref([]), loading = ref(true), currentUser = ref(null)
const promoCode = ref(''), promoApplied = ref(false), promoError = ref('')
const activeCoupons = ref([]), appliedCoupon = ref(null)
const shippingConfig = ref({ fee: 60, freeThreshold: 499, isFreeShippingActive: true })

onMounted(() => {
  onAuthStateChanged(auth, async (user) => {
    currentUser.value = user
    if (user) {
      onSnapshot(doc(db, 'carts', user.uid), async (snap) => {
        const items = snap.exists() ? (snap.data().items ?? []) : []
        cartItems.value = items
        liveItems.value = await fetchLiveCartItems(items)
        loading.value = false
      })
      try {
        activeCoupons.value = await fetchCoupons()
        const shipCfg = await fetchShippingConfig()
        if (shipCfg) shippingConfig.value = shipCfg
      } catch (err) { console.warn("Failed retrieving dynamic promotion matrices.") }
    } else { loading.value = false }
  })
})

function getItemStockInfo(item) {
  return liveItems.value.find(li =>
    li.productId === item.productId &&
    (li.variantId === (item.variantId || item.variant || item.weight || 'Standard') ||
     li.variantLabel === (item.variant || item.weight || 'Standard'))
  ) || null
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

const displayItems = computed(() => cartItems.value.map(ci => {
  const live = liveItems.value.find(li => li.productId === ci.productId && (li.variantId === (ci.variantId || ci.variant || ci.weight || 'Standard') || li.variantLabel === (ci.variant || ci.weight || 'Standard')))
  return live ? { ...ci, price: live.price ?? ci.price, name: live.name ?? ci.name, imageUrl: live.imageUrl ?? ci.imageUrl } : ci
}))

const subtotal = computed(() => displayItems.value.reduce((s, i) => s + i.price * i.quantity, 0))
const totalItemCount = computed(() => cartItems.value.reduce((s, i) => s + i.quantity, 0))

const discountAmount = computed(() => {
  if (!promoApplied.value || !appliedCoupon.value) return 0
  if (appliedCoupon.value.type === 'percent') return Math.round(subtotal.value * (appliedCoupon.value.discount / 100))
  return Math.min(subtotal.value, appliedCoupon.value.discount)
})

const shippingCost = computed(() => {
  if (subtotal.value === 0) return 0
  if (shippingConfig.value.isFreeShippingActive && subtotal.value >= shippingConfig.value.freeThreshold) return 0
  return Number(shippingConfig.value.fee) || 0
})

const grandTotal = computed(() => Math.max(subtotal.value - discountAmount.value + shippingCost.value, 0))
const progressToFree = computed(() => {
  if (!shippingConfig.value.isFreeShippingActive) return 0
  return Math.min((subtotal.value / shippingConfig.value.freeThreshold) * 100, 100)
})
const amountNeeded = computed(() => Math.max(shippingConfig.value.freeThreshold - subtotal.value, 0))

async function pushUpdate(updatedItems) {
  if (!currentUser.value) return
  try { await saveCartItems(updatedItems) } catch (e) { console.error('Cart sync failed:', e) }
}

const increaseQty = (idx) => {
  const updated = [...cartItems.value]
  updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 }
  pushUpdate(updated)
}

const decreaseQty = (idx) => {
  const updated = [...cartItems.value]
  if (updated[idx].quantity > 1) {
    updated[idx] = { ...updated[idx], quantity: updated[idx].quantity - 1 }
    pushUpdate(updated)
  } else { removeItem(idx) }
}

const removeItem = (idx) => pushUpdate(cartItems.value.filter((_, i) => i !== idx))
const clearEntireCart = () => { if (confirm('Empty your basket?')) pushUpdate([]) }

const applyVoucher = () => {
  promoError.value = ''; promoApplied.value = false; appliedCoupon.value = null
  const code = promoCode.value.trim().toUpperCase()
  const verifiedCoupon = activeCoupons.value.find(c => c.code === code && c.active)

  if (!verifiedCoupon) { promoError.value = "Invalid or inactive coupon."; return }
  if (verifiedCoupon.expiresAt && Date.now() > verifiedCoupon.expiresAt) { promoError.value = "This coupon has expired."; return }
  if (subtotal.value < verifiedCoupon.minOrderAmount) { promoError.value = `Add ₹${verifiedCoupon.minOrderAmount - subtotal.value} more to use this code.`; return }
  if (totalItemCount.value < verifiedCoupon.minItems) { promoError.value = `Need at least ${verifiedCoupon.minItems} items.`; return }

  appliedCoupon.value = verifiedCoupon; promoApplied.value = true
  window.sessionStorage.setItem('active_promo_discount', discountAmount.value)
  window.sessionStorage.setItem('active_promo_code', verifiedCoupon.code)
}

const clearVoucher = () => {
  promoCode.value = ''; promoApplied.value = false; appliedCoupon.value = null; promoError.value = ''
  window.sessionStorage.removeItem('active_promo_discount')
  window.sessionStorage.removeItem('active_promo_code')
}
</script>

<template>
  <div class="cart-page-wrapper">
    <div class="cart-container">

      <!-- Simplified header -->
      <header class="cart-header">
        <h1>Your Basket</h1>
        <p v-if="cartItems.length > 0">{{ totalItemCount }} item{{ totalItemCount > 1 ? 's' : '' }} reserved</p>
      </header>

      <div v-if="loading" class="cart-state-card"><div class="spinner"></div><p>Loading your basket…</p></div>
      <div v-else-if="!currentUser" class="cart-state-card isolated-auth"><span class="state-glyph">🔒</span><h3>Sign in required</h3><p>Please log in to view your basket.</p><router-link to="/login" class="shop-btn">Go to Login</router-link></div>
      <div v-else-if="cartItems.length === 0" class="cart-state-card isolated-auth"><span class="state-glyph">🛒</span><h3>Your basket is empty</h3><p>Discover mountain‑fresh products.</p><router-link to="/products" class="shop-btn">Browse Products</router-link></div>

      <div v-else class="cart-split-layout fade-in">
        <main class="cart-main-list">
          <!-- Shipping progress -->
          <div v-if="shippingConfig.isFreeShippingActive" class="shipping-tracker-card">
            <p v-if="subtotal < shippingConfig.freeThreshold">Add <strong>₹{{ amountNeeded }}</strong> more to unlock <strong>FREE Shipping!</strong></p>
            <p v-else>🎉 You've unlocked free shipping!</p>
            <div class="progress-bar-container"><div class="progress-fill" :style="{ width: progressToFree + '%' }"></div></div>
          </div>

          <!-- Single box for all items -->
          <div class="cart-items-wrapper">
            <div v-for="(item, idx) in displayItems" :key="idx" :class="['cart-item-row', { 'out-of-stock-row': isItemOutOfStock(item) }]">
              
              <!-- Image (no emoji fallback) -->
              <router-link :to="`/product/${item.slug || 'product'}--${item.productId}`" class="item-img-link">
                <img v-if="item.imageUrl" :src="item.imageUrl" class="item-visual-img" />
                <span v-else class="item-placeholder">🌾</span>
              </router-link>
              
              <div class="item-core-details">
                <div class="item-title-row">
                  <div>
                    <router-link :to="`/product/${item.slug || 'product'}--${item.productId}`" class="item-title-link">
                      {{ item.name }}
                    </router-link>
                    <span class="item-variant-tag">{{ item.variant || item.variantId || item.weight || 'Standard' }}</span>
                    <span v-if="getStockLabel(item)" :class="['stock-badge', { 'oos': isItemOutOfStock(item), 'low': !isItemOutOfStock(item) }]">
                      {{ getStockLabel(item) }}
                    </span>
                  </div>
                  <div class="item-price-display">
                    <strong>₹{{ item.price * item.quantity }}</strong>
                    <span v-if="item.quantity > 1" class="unit-price">₹{{ item.price }} each</span>
                  </div>
                </div>

                <!-- Actions: quantity + delete (no note) -->
                <div class="item-actions-row">
                  <div class="quantity-pill">
                    <button class="qty-btn" @click="decreaseQty(idx)">−</button>
                    <span class="qty-val">{{ item.quantity }}</span>
                    <button class="qty-btn" @click="increaseQty(idx)">+</button>
                  </div>
                  <button class="delete-btn" @click="removeItem(idx)" title="Remove item">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button class="clear-basket-link" @click="clearEntireCart">Empty Basket</button>
        </main>

        <aside class="cart-summary-sidebar">
          <h3>Order Summary</h3>
          <div class="summary-line"><span>Subtotal</span><span>₹{{ subtotal }}</span></div>
          <div v-if="promoApplied" class="summary-line text-green"><span>{{ appliedCoupon.code }} ({{ appliedCoupon.type === 'percent' ? appliedCoupon.discount + '%' : '₹' + appliedCoupon.discount }})</span><span>-₹{{ discountAmount }}</span></div>
          <div class="summary-line"><span>Shipping</span><span v-if="shippingCost === 0" class="free-shipping-tag">FREE</span><span v-else>₹{{ shippingCost }}</span></div>

          <div class="promo-coupon-box">
            <div class="promo-input-row">
              <input v-model="promoCode" placeholder="Coupon code" :disabled="promoApplied" class="promo-input" />
              <button v-if="!promoApplied" @click="applyVoucher" class="promo-btn">Apply</button>
              <button v-else @click="clearVoucher" class="promo-btn clear-promo">✕</button>
            </div>
            <p v-if="promoError" class="promo-error">{{ promoError }}</p>
            <p v-if="promoApplied" class="promo-success">✓ Discount applied.</p>
          </div>

          <div class="summary-divider"></div>
          <div class="summary-line total-bill-row"><span>Total</span><span>₹{{ grandTotal }}</span></div>
          
          <router-link to="/checkout" class="checkout-submit-btn">Proceed to Checkout</router-link>
          <!-- Disclaimer removed -->
        </aside>

      </div>
    </div>
  </div>
</template>

<style scoped>
.cart-page-wrapper{background:#faf7f4;min-height:100vh;padding:120px 20px 80px;font-family:'Jost',sans-serif;color:#1a1a2e}
.cart-container{max-width:1140px;margin:0 auto}
.cart-header{text-align:center;margin-bottom:28px}
.cart-header h1{font-family:'Inter',sans-serif;font-size:1.8rem;font-weight:700;margin:0 0 4px;color:#1a1a2e;letter-spacing:-0.3px}
.cart-header p{color:#6b5f55;margin:0;font-size:0.9rem;font-weight:500}
.cart-state-card{background:#ffffff;border-radius:12px;padding:40px 24px;text-align:center;max-width:380px;margin:32px auto;box-shadow:0 4px 12px rgba(0,0,0,0.02);border:1px solid #ede8e2}
.state-glyph{font-size:2.8rem;display:block;margin-bottom:10px}
.cart-state-card h3{font-family:'Inter',sans-serif;margin:0 0 6px;font-size:1.2rem;font-weight:600;color:#1a1a2e}
.cart-state-card p{color:#6b5f55;font-size:0.9rem;margin:0 0 20px}
.shop-btn{display:inline-block;background:#1a1a2e;color:#fff;padding:10px 24px;border-radius:8px;font-weight:600;text-decoration:none;font-size:0.85rem;transition:all 0.25s}
.shop-btn:hover{background:#16a34a;transform:translateY(-2px);box-shadow:0 4px 12px rgba(22,163,74,0.2)}
.spinner{width:32px;height:32px;border:3px solid #ede8e2;border-top-color:#16a34a;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 10px}
@keyframes spin{to{transform:rotate(360deg)}}
.cart-split-layout{display:grid;grid-template-columns:1fr 320px;gap:28px;align-items:start}
.cart-main-list{display:flex;flex-direction:column;gap:12px}
.shipping-tracker-card{background:#ffffff;border-radius:10px;padding:12px 18px;font-size:0.85rem;box-shadow:0 2px 8px rgba(0,0,0,0.02);border:1px solid #ede8e2}
.shipping-tracker-card p{margin:0 0 8px;color:#4a3f35}
.progress-bar-container{background:#ede8e2;height:5px;border-radius:999px;overflow:hidden}
.progress-fill{background:#16a34a;height:100%;transition:width 0.5s ease}

/* ─── Single unified box for items ─── */
.cart-items-wrapper{
  background:#ffffff;
  border-radius:12px;
  border:1px solid #ede8e2;
  padding:4px 0;
  box-shadow:0 2px 8px rgba(0,0,0,0.02)
}
.cart-item-row{
  display:flex;
  align-items:center;
  gap:14px;
  padding:12px 16px;
  border-bottom:1px solid #ede8e2
}
.cart-item-row:last-child{border-bottom:none}
.item-img-link{
  width:56px;
  height:56px;
  border-radius:8px;
  background:#faf7f4;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow:hidden;
  flex-shrink:0;
  text-decoration:none;
  border:1px solid #ede8e2
}
.item-img-link:hover{opacity:0.9}
.item-visual-img{width:100%;height:100%;object-fit:cover}
.item-placeholder{font-size:1.4rem;color:#6b5f55}
.item-core-details{flex:1;display:flex;flex-direction:column;gap:6px}
.item-title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.item-title-link{font-size:0.95rem;font-weight:600;color:#1a1a2e;text-decoration:none;transition:0.2s}
.item-title-link:hover{color:#16a34a}
.item-variant-tag{font-size:0.6rem;color:#6b5f55;font-weight:500;text-transform:uppercase;background:#ede8e2;padding:2px 8px;border-radius:100px;display:inline-block;margin-left:6px}
.item-price-display{text-align:right;flex-shrink:0}
.item-price-display strong{font-size:1rem;font-weight:600;color:#1a1a2e}
.unit-price{font-size:0.65rem;color:#9a8a7a;display:block;margin-top:2px}
.item-actions-row{display:flex;align-items:center;gap:12px}
.quantity-pill{display:flex;align-items:center;background:#faf7f4;border-radius:30px;border:1px solid #ede8e2}
.qty-btn{background:transparent;border:none;width:28px;height:28px;font-size:0.9rem;font-weight:600;color:#1a1a2e;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:0.15s}
.qty-btn:hover{background:#ede8e2}
.qty-val{width:24px;text-align:center;font-size:0.85rem;font-weight:600;color:#1a1a2e}
.delete-btn{background:transparent;border:none;color:#9a8a7a;cursor:pointer;padding:4px;border-radius:6px;font-size:0.9rem;transition:0.2s}
.delete-btn:hover{background:#fef2f2;color:#dc2626}

/* ─── Out of Stock Indicators ─── */
.stock-badge{font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:100px;display:inline-block;margin-left:6px;text-transform:uppercase;letter-spacing:0.3px}
.stock-badge.oos{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
.stock-badge.low{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.out-of-stock-row{opacity:0.75;background:#fefbfb;border-left:3px solid #dc2626}
.out-of-stock-row .item-title-link{color:#9a8a7a}
.out-of-stock-row .item-price-display strong{color:#9a8a7a;text-decoration:line-through}

.clear-basket-link{background:transparent;border:none;color:#6b5f55;font-size:0.8rem;font-weight:500;cursor:pointer;padding:8px 16px;border-radius:6px;transition:0.2s;display:block;text-align:left;width:100%}
.clear-basket-link:hover{background:#ede8e2;color:#1a1a2e}

/* ─── Summary ─── */
.cart-summary-sidebar{background:#ffffff;border-radius:12px;padding:20px 22px;box-shadow:0 4px 12px rgba(0,0,0,0.02);border:1px solid #ede8e2;position:sticky;top:110px}
.cart-summary-sidebar h3{font-family:'Inter',sans-serif;margin:0 0 16px;font-size:1rem;font-weight:600;color:#1a1a2e}
.summary-line{display:flex;justify-content:space-between;font-size:0.85rem;color:#5a4f45;margin-bottom:10px;font-weight:500}
.text-green{color:#16a34a!important;font-weight:600}
.free-shipping-tag{color:#16a34a;font-weight:600;background:#f0fdf4;padding:2px 8px;border-radius:100px;font-size:0.65rem;border:1px solid #bbf7d0}
.promo-coupon-box{margin:16px 0}
.promo-input-row{display:flex;gap:6px}
.promo-input{flex:1;padding:6px 12px;border:1px solid #ede8e2;border-radius:6px;font-family:inherit;font-size:0.8rem;outline:none;background:#faf7f4;transition:0.2s}
.promo-input:focus{border-color:#16a34a;background:#fff;box-shadow:0 0 0 3px rgba(22,163,74,0.08)}
.promo-btn{padding:0 16px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;transition:0.2s;font-size:0.8rem}
.promo-btn:hover:not(:disabled){background:#16a34a}
.promo-btn:disabled{opacity:0.5;cursor:not-allowed}
.clear-promo{background:#ede8e2;color:#1a1a2e}
.clear-promo:hover{background:#fee2e2;color:#dc2626}
.promo-error{margin:4px 0 0;font-size:0.75rem;color:#dc2626;font-weight:500}
.promo-success{margin:4px 0 0;font-size:0.75rem;color:#16a34a;font-weight:600}
.summary-divider{height:1px;background:#ede8e2;margin:16px 0}
.total-bill-row{font-size:1.2rem!important;font-weight:700;color:#1a1a2e;margin:0 0 16px;align-items:center}
.checkout-submit-btn{display:block;text-align:center;text-decoration:none;background:#1a1a2e;color:#fff;padding:12px;border-radius:8px;font-weight:600;font-size:0.9rem;text-transform:uppercase;letter-spacing:0.3px;transition:all 0.25s;box-shadow:0 4px 12px rgba(26,26,46,0.1)}
.checkout-submit-btn:hover{background:#16a34a;box-shadow:0 6px 16px rgba(22,163,74,0.2);transform:translateY(-2px)}
.fade-in{animation:fIn 0.3s ease-out}
@keyframes fIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:960px){.cart-split-layout{grid-template-columns:1fr;gap:20px}.cart-summary-sidebar{position:static}}
@media(max-width:640px){.cart-page-wrapper{padding:100px 12px 80px}.cart-item-row{flex-wrap:wrap;gap:10px}.item-img-link{width:48px;height:48px}.item-title-row{flex-wrap:wrap}.item-price-display{text-align:left;width:100%}.item-actions-row{width:100%;justify-content:space-between}}
</style>