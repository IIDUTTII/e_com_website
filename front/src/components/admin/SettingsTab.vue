<script setup>
import { ref, onMounted } from 'vue'
import { fetchCoupons, saveCoupons, deleteCouponFromDb, fetchGatewayConfig, setCodStatus, fetchShippingConfig, updateShippingConfig } from '../db.js'

const props = defineProps({ userRole: { type: String, default: 'user' } })

const isCodActive = ref(true)
const coupons = ref([])
const couponSaving = ref(false)
const newCoupon = ref({ code: '', discount: 10, type: 'percent', minOrderAmount: 0, minItems: 0, expiresAt: '', maxUses: 0, active: true })

const shippingConfig = ref({ fee: 60, freeThreshold: 499, isFreeShippingActive: true })
const shippingSaving = ref(false)

onMounted(async () => {
  try {
    const cfg = await fetchGatewayConfig()
    if (cfg) isCodActive.value = cfg.isCodActive ?? true

    const shipCfg = await fetchShippingConfig()
    if (shipCfg) shippingConfig.value = { ...shippingConfig.value, ...shipCfg }

    coupons.value = await fetchCoupons()
  } catch (e) { console.warn('Settings load failed:', e.message) }
})

const toggleCod = async () => {
  const next = !isCodActive.value
  try { await setCodStatus(next); isCodActive.value = next } catch (e) { alert(e.message) }
}

// ✨ NEW SHIPPING SAVE FUNCTION
const saveShippingSettings = async () => {
  shippingSaving.value = true
  try {
    await updateShippingConfig({
      fee: Number(shippingConfig.value.fee),
      freeThreshold: Number(shippingConfig.value.freeThreshold),
      isFreeShippingActive: shippingConfig.value.isFreeShippingActive
    })
    alert('Logistics & Shipping settings synchronized successfully!')
  } catch (e) {
    alert(e.message)
  } finally {
    shippingSaving.value = false
  }
}

const addCoupon = () => {
  if (!newCoupon.value.code.trim()) { alert('Please enter a Coupon Code.'); return }
  coupons.value.push({ ...newCoupon.value, code: newCoupon.value.code.toUpperCase(), expiresAt: newCoupon.value.expiresAt ? new Date(newCoupon.value.expiresAt).getTime() : null })
  newCoupon.value = { code: '', discount: 10, type: 'percent', minOrderAmount: 0, minItems: 0, expiresAt: '', maxUses: 0, active: true }
}

const removeCoupon = async (idx) => {
  const targetCoupon = coupons.value[idx]
  if (confirm(`Permanently delete the ${targetCoupon.code} voucher?`)) {
    try { await deleteCouponFromDb(targetCoupon.code); coupons.value.splice(idx, 1) } catch (e) { alert("Failed: " + e.message) }
  }
}

const toggleCouponActive = async (idx) => { 
  coupons.value[idx].active = !coupons.value[idx].active 
  await saveCouponList()
}

const saveCouponList = async () => {
  couponSaving.value = true
  try { await saveCoupons(coupons.value); alert('Coupons synchronized to database successfully!') } catch (e) { alert(e.message) } finally { couponSaving.value = false }
}
</script>

<template>
  <div class="fade-in">
    <div class="ws-head">
      <div>
        <h2 class="ws-title">System Settings</h2>
        <p class="ws-sub">Manage gateways, logistics, and promotional matrices.</p>
      </div>
    </div>

    <section class="settings-card">
      <div class="card-header"><h3>Payment Gateways</h3><p>Control checkout payment lanes for customers.</p></div>
      <div class="setting-row">
        <div><strong>Cash on Delivery (COD)</strong><p>Allow users to place orders without upfront payment.</p></div>
        <button class="cod-btn" :class="isCodActive ? 'cod-on' : 'cod-off'" @click="toggleCod"><span class="cod-dot"></span> {{ isCodActive ? 'Enabled' : 'Disabled' }}</button>
      </div>
    </section>

    <section class="settings-card">
      <div class="card-header"><h3>Logistics & Delivery</h3><p>Set shipping fees and free delivery thresholds.</p></div>
      
      <div class="form-grid" style="background: #F8FAFC; padding: 20px; border-radius: 12px; border: 1px solid #E2E8F0;">
        <div class="input-col">
          <label>Standard Shipping Fee (₹)</label>
          <input v-model.number="shippingConfig.fee" type="number" class="c-input" min="0" />
        </div>
        
        <div class="input-col">
          <label>Free Shipping Target (₹)</label>
          <input v-model.number="shippingConfig.freeThreshold" type="number" class="c-input" min="0" :disabled="!shippingConfig.isFreeShippingActive" />
        </div>
        
        <div class="input-col" style="justify-content: center;">
          <label class="toggle-label" style="margin-top: 10px;">
            <input type="checkbox" v-model="shippingConfig.isFreeShippingActive" style="width: 18px; height: 18px; accent-color: #0F2A1F;" />
            Enable Free Shipping Threshold
          </label>
        </div>
      </div>
      
      <button class="btn-primary" style="margin-top: 16px;" :disabled="shippingSaving" @click="saveShippingSettings">
        {{ shippingSaving ? 'Saving...' : 'Save Shipping Config' }}
      </button>
    </section>


    <section class="settings-card">
      <div class="card-header"><h3>Promotional Vouchers</h3><p>Create and manage discount codes.</p></div>

      <div class="coupon-form-box">
        <h4>Generate New Voucher</h4>
        <div class="form-grid">
          <div class="input-col"><label>Coupon Code</label><input v-model="newCoupon.code" placeholder="e.g. FESTIVAL20" class="c-input" style="text-transform:uppercase;" /></div>
          <div class="input-col"><label>Discount Type</label><select v-model="newCoupon.type" class="c-input"><option value="percent">Percentage (%)</option><option value="flat">Flat Rate (₹)</option></select></div>
          <div class="input-col"><label>Discount Value</label><input v-model.number="newCoupon.discount" type="number" class="c-input" /></div>
          <div class="input-col"><label>Min Order (₹)</label><input v-model.number="newCoupon.minOrderAmount" type="number" class="c-input" /></div>
          <div class="input-col"><label>Usage Limit</label><input v-model.number="newCoupon.maxUses" type="number" placeholder="0 = Unlimited" class="c-input" /></div>
          <div class="input-col"><label>Expires At</label><input v-model="newCoupon.expiresAt" type="date" class="c-input" /></div>
        </div>
        <button class="btn-primary" style="margin-top: 16px;" @click="addCoupon">+ Add to List</button>
      </div>

      <div class="coupon-list">
        <h4>Active Database Entries ({{ coupons.length }})</h4>
        <div v-if="coupons.length === 0" class="empty-note">No active coupons found.</div>
        <div v-for="(c, i) in coupons" :key="i" class="coupon-row">
          <div class="c-info">
            <code class="c-code">{{ c.code }}</code>
            <span class="c-meta">
              {{ c.type === 'percent' ? c.discount + '%' : '₹' + c.discount }} OFF
              <span v-if="c.minOrderAmount > 0">| Min Spend: ₹{{ c.minOrderAmount }}</span>
              <span v-if="c.maxUses > 0">| Used: {{ c.usageCount || 0 }}/{{ c.maxUses }}</span>
            </span>
          </div>
          <div class="c-actions">
            <span :class="['status-pill', c.active ? 'pill-green' : 'pill-amber']">{{ c.active ? 'Active' : 'Inactive' }}</span>
            <button class="btn-outline" @click="toggleCouponActive(i)">Toggle</button>
            <button class="btn-danger" @click="removeCoupon(i)">Delete</button>
          </div>
        </div>
        <button class="btn-primary full-width" style="margin-top: 24px; font-size:1.05rem;" :disabled="couponSaving" @click="saveCouponList">{{ couponSaving ? 'Synchronizing...' : 'Save & Deploy All Coupons' }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fade-in { animation: fIn 0.3s ease-out; }
@keyframes fIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.ws-head { margin-bottom: 24px; }
.ws-title { font-size: 1.6rem; font-weight: 800; color: #0F172A; margin: 0; }
.ws-sub { color: #64748B; font-size: 0.9rem; margin-top: 4px; }

.settings-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.02); margin-bottom: 24px; }
.card-header h3 { font-size: 1.2rem; font-weight: 800; color: #0F172A; margin: 0 0 6px; }
.card-header p { color: #64748B; font-size: 0.9rem; margin: 0 0 20px; }

.setting-row { display: flex; justify-content: space-between; align-items: center; padding: 16px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; }
.setting-row strong { font-size: 1.05rem; color: #0F172A; display: block; margin-bottom: 4px; }
.setting-row p { margin: 0; font-size: 0.85rem; color: #64748B; }

.cod-btn { display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 30px; border: 2px solid; font-size: 0.9rem; font-weight: 800; cursor: pointer; transition: 0.2s; }
.cod-on  { border-color: #15803D; background: #F0FDF4; color: #15803D; }
.cod-off { border-color: #DC2626; background: #FEF2F2; color: #DC2626; }
.cod-dot { width: 10px; height: 10px; border-radius: 50%; background: currentColor; }

.coupon-form-box { background: #F8FAFC; padding: 20px; border-radius: 12px; border: 1px dashed #CBD5E1; margin-bottom: 30px; }
.coupon-form-box h4 { margin: 0 0 16px; color: #0F172A; font-weight: 800; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.input-col { display: flex; flex-direction: column; gap: 6px; }
.input-col label { font-size: 0.8rem; font-weight: 700; color: #475569; text-transform: uppercase; }
.c-input { padding: 10px; border: 1px solid #CBD5E1; border-radius: 8px; outline: none; font-family: inherit; font-size: 0.95rem; }
.c-input:focus { border-color: #0F2A1F; }

.toggle-label { font-size: 0.9rem; font-weight: 700; color: #0F172A; display: flex; align-items: center; gap: 8px; cursor: pointer; }

.btn-primary { background: #0F2A1F; color: white; padding: 12px 24px; border: none; border-radius: 8px; font-weight: 800; cursor: pointer; transition: 0.2s; }
.btn-primary:hover:not(:disabled) { background: #0a1c14; }
.btn-primary:disabled { opacity: 0.7; cursor: not-allowed; }

.coupon-list h4 { margin: 0 0 16px; color: #0F172A; font-weight: 800; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px; }
.coupon-row { display: flex; justify-content: space-between; align-items: center; padding: 16px; border: 1px solid #E2E8F0; border-radius: 12px; margin-bottom: 12px; flex-wrap: wrap; gap: 16px; }
.c-info { display: flex; flex-direction: column; gap: 6px; }
.c-code { background: #0F172A; color: white; padding: 4px 10px; border-radius: 6px; font-family: monospace; font-size: 1rem; font-weight: 800; width: fit-content; }
.c-meta { font-size: 0.85rem; color: #475569; font-weight: 600; }

.c-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.status-pill { padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; }
.pill-green { background: #DCFCE7; color: #15803D; border: 1px solid #BBF7D0; }
.pill-amber { background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; }

.btn-outline { background: white; border: 1px solid #CBD5E1; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; color: #0F172A; }
.btn-danger { background: #FEF2F2; border: 1px solid #FECACA; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; color: #DC2626; }
.full-width { width: 100%; }
.full-span { grid-column: 1 / -1; }
.secret-box { margin-top: 18px; padding: 18px; border: 1px dashed #CBD5E1; border-radius: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; align-items: end; background: #FFF7ED; }
.locked-card { opacity: 0.75; }
.empty-note { padding: 30px; text-align: center; color: #64748B; background: #F8FAFC; border-radius: 12px; border: 1px dashed #CBD5E1; }
</style>