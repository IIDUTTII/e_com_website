<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { auth, db } from '../firebase.js'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { updateOrderStatus, formatOrderStatus, cancelCustomerOrder, requestRefund, requestReturnFSM, WAREHOUSE_ADDRESS } from './db.js'

defineOptions({ name: 'UserOrders' })
const router = useRouter()

const initializing = ref(true)
const userOrders = ref([])
const activeTab = ref('all')
const searchQ = ref('')
const selectedOrder = ref(null)

// ✋ Cancellation guard for the customer — typed confirmation modal
const cancelGuard = ref(null)
function openCancelGuard(order) {
  cancelGuard.value = { orderId: order?.id || '', shortId: (order?.id || '').slice(0, 8).toUpperCase(), typed: '', processing: false }
}
function closeCancelGuard() { cancelGuard.value = null }
const cancelGuardReady = computed(() =>
  cancelGuard.value && cancelGuard.value.typed.trim().toUpperCase() === cancelGuard.value.shortId
)

/* ─── Robust Date Parser ───
   Handles Firestore Timestamp (.toDate() & {seconds,nanoseconds}),
   ISO strings, numbers, Date objects, and null/undefined.        */
const toDate = (ts) => {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'string') {
    const d = new Date(ts)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof ts === 'number') {
    const d = new Date(ts)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof ts === 'object') {
    if (typeof ts.toDate === 'function') {
      try { return ts.toDate() } catch (e) { return null }
    }
    if (ts.seconds != null) {
      return new Date(ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6)
    }
  }
  return null
}
const getSortTime = (order) => {
  const d = toDate(order?.updatedAt) || toDate(order?.createdAt)
  return d ? d.getTime() : 0
}

const requestType = ref('')
const requestReason = ref('')
const selectedReturnItems = ref([])
const showRequestForm = ref(false)
const processingAction = ref(false)

onMounted(() => {
  auth.onAuthStateChanged(async (currentUser) => {
    if (!currentUser) return router.push('/login')
    
    const q = query(collection(db, 'orders'), where('userId', '==', currentUser.uid))
    onSnapshot(q, (snap) => {
      userOrders.value = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => getSortTime(b) - getSortTime(a))
      
      if(selectedOrder.value) {
        const updated = userOrders.value.find(o => o.id === selectedOrder.value.id)
        if(updated) selectedOrder.value = updated
      }
      initializing.value = false
    })
  })
})

const filteredOrders = computed(() => {
  let list = userOrders.value
  if (activeTab.value === 'pending') list = list.filter(o => o.shippingStatus === 'pending')
  else if (activeTab.value === 'confirmed') list = list.filter(o => o.shippingStatus === 'confirmed')
  else if (activeTab.value === 'shipped') list = list.filter(o => o.shippingStatus === 'shipped')
  else if (activeTab.value === 'delivered') list = list.filter(o => o.shippingStatus === 'delivered')
  else if (activeTab.value === 'returns') list = list.filter(o => ['return_requested', 'returned_refund_pending', 'replacement_requested', 'replacement_approved', 'replaced'].includes(o.shippingStatus))
  else if (activeTab.value === 'cancelled') list = list.filter(o => ['rejected', 'cancelled', 'cancelled_refund_pending', 'refunded'].includes(o.shippingStatus))

  if (searchQ.value.trim()) {
    const q = searchQ.value.toLowerCase()
    list = list.filter(o =>
      (o.id || '').toLowerCase().includes(q) ||
      (o.items || []).some(item => (item.name || '').toLowerCase().includes(q))
    )
  }
  return list
})

const fmtDate = (ts) => {
  const d = toDate(ts)
  return d ? d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'
}
const fmtDateTime = (ts) => {
  const d = toDate(ts)
  return d ? d.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'
}
const money = (val) => `₹${Number(val || 0).toLocaleString('en-IN')}`

/* Friendly text for the pickup mode admin sets. */
const pickupGuidance = (order) => {
  if (!order?.pickupMode) return null
  if (order.pickupMode === 'pickup') {
    return {
      icon: '🚚',
      title: 'Reverse Pickup Scheduled',
      body: 'Our delivery partner will pick up the original item from your address. Please keep the item packed and your phone reachable.',
      tone: 'info',
    }
  }
  if (order.pickupMode === 'selfship') {
    return {
      icon: '📮',
      title: 'Self-Ship via India Post / Speed Post',
      body: 'Please courier the original item to our warehouse address below. Mail it within 5 days.',
      tone: 'success',
      showAddress: true,
    }
  }
  return null
}

const copyWarehouseAddr = async () => {
  const text = [
    WAREHOUSE_ADDRESS.name,
    WAREHOUSE_ADDRESS.line1,
    WAREHOUSE_ADDRESS.line2,
    `${WAREHOUSE_ADDRESS.country} – ${WAREHOUSE_ADDRESS.pincode}`,
    `Phone: ${WAREHOUSE_ADDRESS.phone}`,
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    alert('Warehouse address copied. Paste it on your Speed Post parcel.')
  } catch (e) {
    alert('Copy failed. Address:\n\n' + text)
  }
}

// ✨ SENIOR LOGIC: Check if order was delivered within last 48 hours (2 Days)
const isWithinReturnWindow = (order) => {
  if (order.shippingStatus !== 'delivered' || !order.deliveredAt) return false
  const delivered = toDate(order.deliveredAt)
  if (!delivered) return false
  const twoDaysInMs = 2 * 24 * 60 * 60 * 1000
  return (Date.now() - delivered.getTime()) <= twoDaysInMs
}

// Build order timeline from available timestamps
const getOrderTimeline = (order) => {
  const events = []
  if (order.createdAt) events.push({ label: 'Order Placed', time: order.createdAt, icon: '📦', status: 'completed' })
  if (order.confirmedAt) events.push({ label: 'Confirmed', time: order.confirmedAt, icon: '✅', status: 'completed' })
  else if (order.shippingStatus !== 'pending') events.push({ label: 'Confirmed', time: null, icon: '✅', status: 'completed' })
  if (order.shippedAt || order.trackingId) events.push({ label: 'Shipped', time: order.shippedAt, icon: '🚚', status: order.shippingStatus === 'shipped' || order.shippingStatus === 'delivered' ? 'completed' : 'current' })
  if (order.deliveredAt) events.push({ label: 'Delivered', time: order.deliveredAt, icon: '📦', status: 'completed' })
  if (order.cancelledAt) events.push({ label: 'Cancelled', time: order.cancelledAt, icon: '❌', status: 'completed', reason: order.cancelReason || order.adminComment })
  if (order.refundedAt) events.push({ label: 'Refunded', time: order.refundedAt, icon: '💰', status: 'completed' })
  return events
}

const handleCustomerCancel = async (order) => {
  const reason = prompt('Please enter a reason for cancelling this order:')
  if (reason === null) return // User clicked cancel

  const isPaid = order.paymentMethod === 'online' && order.paymentStatus === 'paid'
  if (isPaid) {
    // Open typed-confirm modal to prevent misclicks on paid cancellation
    selectedOrder.value = order
    openCancelGuard(order)
    cancelGuard.value.reason = reason.trim()
    return
  }

  if (!confirm('Are you sure you want to cancel this order?')) return
  processingAction.value = true
  try {
    await cancelCustomerOrder(order.id, reason.trim())
  } catch(e) {
    alert("Cancellation failed: " + e.message)
  } finally {
    processingAction.value = false
  }
}

const confirmCustomerCancellation = async () => {
  if (!cancelGuardReady.value || !cancelGuard.value) return
  cancelGuard.value.processing = true
  processingAction.value = true
  try {
    await cancelCustomerOrder(cancelGuard.value.orderId, cancelGuard.value.reason || 'Cancelled by customer')
    cancelGuard.value = null
  } catch(e) {
    alert('Cancellation failed: ' + e.message)
  } finally {
    cancelGuard.value && (cancelGuard.value.processing = false)
    processingAction.value = false
  }
}

const handleRequestRefund = async () => {
  const reason = prompt('Please enter the reason for refund request')
  if (!reason || !reason.trim()) return
  processingAction.value = true
  try {
    await requestRefund(selectedOrder.value.id, reason.trim())
    alert('Refund request submitted successfully.')
  } catch (e) {
    alert('Refund request failed: ' + e.message)
  } finally {
    processingAction.value = false
  }
}

const openRequestForm = (type) => {
  requestType.value = type
  requestReason.value = ''
  selectedReturnItems.value = []
  showRequestForm.value = true
}

const submitReverseLogisticsRequest = async () => {
  if (selectedReturnItems.value.length === 0) return alert("Please select at least one item to return/replace.")
  if (!requestReason.value.trim()) return alert("Please specify a reason for your request.")

  processingAction.value = true
  const statusPayload = requestType.value === 'return' ? 'return_requested' : 'replacement_requested'

  const note = requestReason.value.trim()
  const updateFields = {
    shippingStatus: statusPayload,
    [requestType.value === 'return' ? 'returnReason' : 'replacementReason']: note,
    returnRequestedItems: selectedReturnItems.value
  }

  try {
    if (requestType.value === 'return') {
      // Use the FSM endpoint so a history entry is recorded for customer-care.
      try {
        await requestReturnFSM(selectedOrder.value.id, note)
      } catch (fsmErr) {
        // If the FSM endpoint rejects (e.g. status not 'delivered'),
        // do not fall back silently — surface the message.
        throw fsmErr
      }
      // Persist the items list + reason alongside (matches existing fields).
      await updateOrderStatus(selectedOrder.value.id, {
        returnReason: note,
        returnRequestedItems: selectedReturnItems.value
      })
    } else {
      await updateOrderStatus(selectedOrder.value.id, updateFields)
    }
    alert(`Your ${requestType.value} request has been submitted successfully.`)
    showRequestForm.value = false
  } catch(e) { alert("Request crashed: " + e.message) }
  finally { processingAction.value = false }
}

const closeOrderModal = () => { selectedOrder.value = null; showRequestForm.value = false }
</script>

<template>
  <div class="vendora-page">
    <div v-if="initializing" class="loading-state"><div class="spinner"></div></div>

    <div v-else class="orders-hub fade-in">
      <header class="vendora-header">
        <span class="breadcrumb">My Account > <span>Order History</span></span>
        <h1 class="page-title">Your Orders</h1>
      </header>

      <div class="table-card">
        <div class="toolbar">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input v-model="searchQ" placeholder="Search product or Order ID..." />
          </div>
          
          <div class="filter-scroll">
            <button :class="['filter-pill', { active: activeTab === 'all' }]" @click="activeTab = 'all'">All</button>
            <button :class="['filter-pill', { active: activeTab === 'pending' }]" @click="activeTab = 'pending'">Pending</button>
            <button :class="['filter-pill', { active: activeTab === 'confirmed' }]" @click="activeTab = 'confirmed'">Confirmed</button>
            <button :class="['filter-pill', { active: activeTab === 'shipped' }]" @click="activeTab = 'shipped'">Shipped</button>
            <button :class="['filter-pill', { active: activeTab === 'delivered' }]" @click="activeTab = 'delivered'">Delivered</button>
            <button :class="['filter-pill', { active: activeTab === 'returns' }]" @click="activeTab = 'returns'">Returns</button>
            <button :class="['filter-pill', { active: activeTab === 'cancelled' }]" @click="activeTab = 'cancelled'">Cancelled</button>
          </div>
        </div>

        <div class="table-responsive">
          <table class="vendora-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Date & Time</th>
                <th>Items Summary</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="filteredOrders.length === 0"><td colspan="7" class="empty-state">No orders found.</td></tr>
              <tr v-for="order in filteredOrders" :key="order.id">
                <td class="id-col">#{{ order.id ? order.id.slice(0,8).toUpperCase() : 'UNKNOWN' }}</td>
                <td class="text-sub">{{ fmtDateTime(order.createdAt) }}</td>
                <td class="items-col">
                  <div class="item-stack">
                    <span v-for="(item, idx) in (order.items || []).slice(0,2)" :key="idx" class="truncate">
                      {{ item.name || 'Item' }} (x{{ item.quantity || 0 }})
                    </span>
                    <span v-if="(order.items || []).length > 2" class="text-sub" style="font-size: 11px;">+{{ (order.items || []).length - 2 }} more</span>
                    <span v-else-if="!(order.items || []).length" class="text-sub" style="font-size: 11px;">No items</span>
                  </div>
                </td>
                <td class="price-col">{{ money(order.amount) }}</td>
                <td>
                  <span class="payment-badge" :class="order.paymentMethod || 'unknown'">
                    {{ (order.paymentMethod || 'N/A').toUpperCase() }}
                    <span v-if="order.paymentStatus" class="payment-status">{{ order.paymentStatus }}</span>
                  </span>
                </td>
                <td><span :class="['soft-pill', order.shippingStatus || 'pending']">{{ formatOrderStatus(order.shippingStatus || 'pending') }}</span></td>
                <td style="text-align: right;"><button class="manage-btn" @click="selectedOrder = order">Details</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- FULL LOGIC MODAL WITH VENDORA UI -->
    <Teleport to="body">
      <div v-if="selectedOrder" class="modal-overlay" @click.self="closeOrderModal">
        <div class="modal-card slide-up">
          
          <div class="modal-header">
            <div>
              <h3 style="margin: 0 0 4px; font-size: 16px; color: #0F172A;">Order #{{ (selectedOrder.id || 'UNKNOWN').toUpperCase() }}</h3>
              <p style="margin: 0; font-size: 13px; color: #64748B;">{{ fmtDateTime(selectedOrder.createdAt) }} • {{ (selectedOrder.paymentMethod || 'N/A').toUpperCase() }} • {{ selectedOrder.paymentStatus || 'pending' }}</p>
            </div>
            <button class="close-btn" @click="closeOrderModal">✕</button>
          </div>

          <div class="modal-body">
            <!-- Order Summary Header -->
            <div class="order-summary-card">
              <div class="summary-grid">
                <div class="summary-item">
                  <span class="summary-label">Order ID</span>
                  <span class="summary-value">{{ selectedOrder.id }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">Order Date</span>
                  <span class="summary-value">{{ fmtDateTime(selectedOrder.createdAt) }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">Payment Method</span>
                  <span class="summary-value">{{ (selectedOrder.paymentMethod || 'N/A').toUpperCase() }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">Payment Status</span>
                  <span class="summary-value" :class="selectedOrder.paymentStatus">{{ selectedOrder.paymentStatus || 'pending' }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">Order Total</span>
                  <span class="summary-value price">{{ money(selectedOrder.amount) }}</span>
                </div>
                <div class="summary-item" v-if="selectedOrder.couponCode">
                  <span class="summary-label">Coupon</span>
                  <span class="summary-value">{{ selectedOrder.couponCode }}</span>
                </div>
              </div>
            </div>

            <!-- Status & Tracking -->
            <div class="status-banner">
              <span class="text-sub">Current Status:</span>
              <span :class="['soft-pill', selectedOrder.shippingStatus || 'pending']" style="margin-left: 10px;">
                {{ formatOrderStatus(selectedOrder.shippingStatus || 'pending') }}
              </span>
            </div>

            <div v-if="selectedOrder.shippingStatus === 'shipped' && selectedOrder.trackingId" class="tracking-zone">
              <span style="font-size: 13px; font-weight: 500;">🚀 Dispatched from Hub</span>
              <a :href="'https://www.shiprocket.in/shipment-tracking/' + selectedOrder.trackingId" target="_blank" class="track-btn">Track Parcel</a>
            </div>

            <!-- Order Timeline -->
            <div class="timeline-section">
              <h4 style="margin: 0 0 12px; font-size: 12px; text-transform: uppercase; color: #94A3B8;">Order Timeline</h4>
              <div class="timeline">
                <div v-for="(event, idx) in getOrderTimeline(selectedOrder)" :key="idx" class="timeline-item" :class="{ 'current': event.status === 'current' }">
                  <div class="timeline-marker" :class="event.status"></div>
                  <div class="timeline-content">
                    <div class="timeline-header">
                      <span class="timeline-icon">{{ event.icon }}</span>
                      <span class="timeline-label">{{ event.label }}</span>
                      <span v-if="event.time" class="timeline-time">{{ fmtDateTime(event.time) }}</span>
                    </div>
                    <p v-if="event.reason" class="timeline-reason">{{ event.reason }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pickup mode banner — shown only when admin has set pickupMode on the order -->
            <div v-if="pickupGuidance(selectedOrder)" class="alert-strip" :class="pickupGuidance(selectedOrder).tone">
              <strong>{{ pickupGuidance(selectedOrder).icon }} {{ pickupGuidance(selectedOrder).title }}</strong>
              <p style="margin: 6px 0 0; font-size: 12px;">{{ pickupGuidance(selectedOrder).body }}</p>
              <div v-if="pickupGuidance(selectedOrder).showAddress" class="warehouse-card">
                <div class="warehouse-line"><strong>{{ WAREHOUSE_ADDRESS.name }}</strong></div>
                <div>{{ WAREHOUSE_ADDRESS.line1 }}</div>
                <div>{{ WAREHOUSE_ADDRESS.line2 }}</div>
                <div>{{ WAREHOUSE_ADDRESS.country }} – <strong>PIN {{ WAREHOUSE_ADDRESS.pincode }}</strong></div>
                <div>📞 {{ WAREHOUSE_ADDRESS.phone }}</div>
                <div class="warehouse-note">🕐 {{ WAREHOUSE_ADDRESS.hours }}</div>
                <div class="warehouse-note">📍 {{ WAREHOUSE_ADDRESS.landmark }}</div>
                <div class="warehouse-note">⚠️ {{ WAREHOUSE_ADDRESS.note }}</div>
                <button class="btn-primary" style="margin-top: 10px;" @click="copyWarehouseAddr">📋 Copy Address</button>
              </div>
            </div>

            <!-- Alerts -->
            <div v-if="['cancelled_refund_pending', 'returned_refund_pending'].includes(selectedOrder.shippingStatus)" class="alert-strip">
              💸 <strong>Refund Pending:</strong> Being processed to original payment method.
            </div>
            <div v-if="selectedOrder.returnRejectReason || selectedOrder.replacementRejectReason" class="alert-strip error">
              ❌ <strong>Request Declined:</strong> {{ selectedOrder.returnRejectReason || selectedOrder.replacementRejectReason }}
            </div>
            <div v-if="selectedOrder.cancelReason && ['cancelled', 'cancelled_refund_pending', 'rejected'].includes(selectedOrder.shippingStatus)" class="alert-strip info">
              📝 <strong>Cancellation Reason:</strong> {{ selectedOrder.cancelReason }}
            </div>
            <div v-if="selectedOrder.adminComment && ['cancelled', 'cancelled_refund_pending', 'rejected'].includes(selectedOrder.shippingStatus)" class="alert-strip info">
              📝 <strong>Admin Note:</strong> {{ selectedOrder.adminComment }}
            </div>

            <!-- Order Items -->
            <div class="modal-items-list">
              <h4 style="margin: 0 0 12px; font-size: 12px; text-transform: uppercase; color: #94A3B8;">Purchased Items</h4>
              <div v-if="!(selectedOrder.items || []).length" style="padding: 8px 0; color: #94A3B8; font-size: 13px;">No items in this order.</div>
              <div v-for="(item, idx) in (selectedOrder.items || [])" :key="idx" class="m-item">
                <img v-if="item.imageUrl" :src="item.imageUrl" class="m-item-img"/>
                <div v-else class="m-item-img" style="display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#94a3b8;font-size:10px;">N/A</div>
                <div class="m-item-info">
                  <span class="item-name">{{ item.name || 'Unnamed Item' }}</span>
                  <span class="text-sub">{{ item.variant || 'Standard' }}</span>
                  <span class="text-sub" style="font-size: 11px;">Product ID: {{ item.productId || 'N/A' }}</span>
                </div>
                <div class="item-price-wrap">
                  <span class="item-price">Qty: {{ item.quantity || 0 }}</span>
                  <span class="item-price">× {{ money(item.price) }}</span>
                  <span class="item-total">{{ money((item.price || 0) * (item.quantity || 0)) }}</span>
                </div>
              </div>
            </div>

            <!-- Shipping Address -->
            <div v-if="selectedOrder.address" class="address-card">
              <h4 style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #94A3B8;">Shipping Address</h4>
              <p style="margin: 0; font-size: 13px; color: #334155; white-space: pre-line;">{{ selectedOrder.address }}</p>
            </div>

            <!-- Actions Zone -->
            <div class="modal-action-zone">
              <div v-if="selectedOrder.shippingStatus === 'pending'" class="action-flex">
                <button class="btn-danger-outline" @click="handleCustomerCancel(selectedOrder)" :disabled="processingAction">Cancel Order</button>
              </div>

              <div v-else-if="selectedOrder.shippingStatus === 'cancelled' && selectedOrder.paymentMethod === 'online' && selectedOrder.paymentStatus === 'paid'">
                <div v-if="!selectedOrder.refund_status">
                  <p class="text-sub" style="margin-bottom: 10px;">💰 This order was paid online and cancelled. You can request a refund.</p>
                  <button class="btn-primary w-100" @click="handleRequestRefund" :disabled="processingAction">
                    Request Refund
                  </button>
                </div>
                <div v-else-if="selectedOrder.refund_status === 'requested'" class="alert-strip">
                  ⏳ Refund request is pending admin approval.
                </div>
                <div v-else-if="selectedOrder.refund_status === 'approved'" class="alert-strip" style="background: #ECFDF5; border-color: #6EE7B7; color: #065F46;">
                  ✅ Refund approved! Admin will process the refund.
                </div>
                <div v-else-if="selectedOrder.refund_status === 'rejected'" class="alert-strip error">
                  ❌ Refund rejected: {{ selectedOrder.refund_reject_reason }}
                </div>
                <div v-else-if="selectedOrder.refund_status === 'completed'" class="alert-strip" style="background: #ECFDF5; border-color: #6EE7B7; color: #065F46;">
                  ✅ Refund completed! Amount has been returned to your payment method.
                </div>
              </div>

              <div v-else-if="selectedOrder.shippingStatus === 'delivered'" class="action-flex">
                <div v-if="isWithinReturnWindow(selectedOrder)">
                  <p class="text-sub" style="margin-top: 0;">You can request a return or replacement within 48 hours of delivery.</p>
                  <div class="btn-group">
                    <button class="btn-outline w-100" @click="openRequestForm('return')">Request Return</button>
                    <button class="btn-primary w-100" @click="openRequestForm('replacement')">Request Replace</button>
                  </div>
                </div>
                <div v-else>
                  <p class="text-sub" style="color: #EF4444; margin: 0;">The 48-hour return window for this order has expired.</p>
                </div>
              </div>

              <!-- Naya Partial Return Form -->
              <div v-if="showRequestForm" class="request-form-box fade-in">
                <h4 style="margin: 0 0 10px; font-size: 13px;">Select items to {{ requestType }}:</h4>
                <div class="return-items-selection">
                  <label v-for="(item, idx) in (selectedOrder.items || [])" :key="idx" class="return-checkbox-label">
                    <input type="checkbox" :value="item.name || 'Item'" v-model="selectedReturnItems" :disabled="item.isReturnable === false" />
                    <span>{{ item.name || 'Item' }} <span v-if="item.isReturnable === false" style="color:red; font-size:11px;">(Non-returnable)</span></span>
                  </label>
                </div>

                <textarea v-model="requestReason" placeholder="Please describe the issue..." class="clean-input" style="margin-top: 10px;"></textarea>
                <div class="btn-group" style="margin-top: 10px;">
                  <button class="btn-outline w-100" @click="showRequestForm = false">Cancel</button>
                  <button class="btn-primary w-100" @click="submitReverseLogisticsRequest" :disabled="processingAction">Submit</button>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    <!-- ✋ Cancellation guard modal (paid orders — typed confirm) -->
      <Teleport to="body">
        <div v-if="cancelGuard" class="modal-overlay" @click.self="closeCancelGuard">
          <div class="modal-card slide-up" style="max-width: 460px;">
            <div class="modal-header" style="background: #FEF2F2;">
              <h3 style="margin: 0; font-size: 16px; color: #DC2626;">⚠️ Confirm Cancellation</h3>
              <button class="close-btn" @click="closeCancelGuard">✕</button>
            </div>
            <div class="modal-body">
              <p style="margin: 0 0 12px; font-size: 13px; color: #475569;">
                You are about to cancel order <code style="background: #F1F5F9; padding: 2px 6px; border-radius: 4px; font-weight: 600;">{{ cancelGuard.shortId }}</code>.
                Since this was paid online, our team will process your refund after pickup/cancellation.
              </p>
              <p style="margin: 0 0 12px; font-size: 12px; color: #94A3B8;">Refund typically takes 5–7 business days.</p>
              <label style="display: block; margin-top: 12px;">
                <span style="font-size: 12px; color: #64748B; display: block; margin-bottom: 6px;">
                  Type the order id <strong>{{ cancelGuard.shortId }}</strong> to confirm:
                </span>
                <input type="text" v-model="cancelGuard.typed" class="clean-input" :placeholder="cancelGuard.shortId" autocomplete="off" style="font-family: monospace; text-transform: uppercase;" />
              </label>
              <div class="btn-group" style="margin-top: 16px;">
                <button class="btn-outline w-100" @click="closeCancelGuard">← Go Back</button>
                <button class="btn-danger w-100" :disabled="!cancelGuardReady || processingAction" @click="confirmCustomerCancellation">🔒 Cancel & Request Refund</button>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </Teleport>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

.vendora-page { min-height: 100vh; background-color: #F8FAFC; padding: 100px 24px 60px; font-family: 'Inter', sans-serif; color: #334155; }
.loading-state { display: flex; justify-content: center; height: 50vh; align-items: center; }
.spinner { width: 30px; height: 30px; border: 3px solid #E2E8F0; border-top-color: #0F172A; border-radius: 50%; animation: rot 0.8s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }
.fade-in { animation: fi 0.3s ease; }
@keyframes fi { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.slide-up { animation: sUp 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes sUp { from { transform: translateY(20px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }

.orders-hub { max-width: 1400px; margin: 0 auto; }
.vendora-header { margin-bottom: 24px; }
.page-title { margin: 8px 0 0; font-size: 24px; font-weight: 600; color: #0F172A; }
.breadcrumb { font-size: 13px; color: #64748B; }
.breadcrumb span { color: #0F172A; font-weight: 500; }

.table-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; }

/* TOOLBAR */
.toolbar { padding: 16px 24px; border-bottom: 1px solid #E2E8F0; display: flex; flex-direction: column; gap: 16px; }
.search-box { position: relative; display: flex; align-items: center; width: 100%; max-width: 400px; }
.search-icon { position: absolute; left: 12px; font-size: 12px; color: #94A3B8; }
.search-box input { width: 100%; padding: 10px 12px 10px 32px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; outline: none; color: #334155; font-family: inherit; }
.search-box input:focus { border-color: #0F172A; }

.filter-scroll { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.filter-scroll::-webkit-scrollbar { display: none; }
.filter-pill { background: transparent; border: 1px solid #E2E8F0; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; color: #64748B; cursor: pointer; white-space: nowrap; transition: 0.2s; }
.filter-pill:hover { border-color: #0F172A; color: #0F172A; }
.filter-pill.active { background: #0F172A; color: white; border-color: #0F172A; }

/* TABLE */
.table-responsive { overflow-x: auto; }
.vendora-table { width: 100%; border-collapse: collapse; min-width: 900px; table-layout: auto; }
.vendora-table th { padding: 14px 24px; background: #FAFAFA; border-bottom: 1px solid #E2E8F0; font-size: 12px; font-weight: 500; color: #64748B; text-align: left; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
.vendora-table td { padding: 16px 24px; border-bottom: 1px solid #F1F5F9; font-size: 14px; color: #334155; font-weight: 400; vertical-align: middle; }
.vendora-table th:nth-child(2), .vendora-table td:nth-child(2) { white-space: nowrap; }
.vendora-table tr:hover td { background-color: #F8FAFC; }

.id-col { font-family: monospace; color: #0F172A; font-weight: 600; font-size: 13px;}
.text-sub { color: #64748B; font-size: 13px; }
.items-col { max-width: 220px; }
.item-stack { display: flex; flex-direction: column; gap: 2px; }
.truncate { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px;}
.price-col { color: #0F172A; font-weight: 600; }
.empty-state { text-align: center; color: #94A3B8; padding: 40px !important; }

.manage-btn { background: white; border: 1px solid #E2E8F0; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 500; cursor: pointer; color: #0F172A; transition: 0.2s; font-family: inherit;}
.manage-btn:hover { background: #F1F5F9; }

/* Payment Badge */
.payment-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.payment-badge.online { background: #EFF6FF; color: #2563EB; }
.payment-badge.cod { background: #FEF3C7; color: #D97706; }
.payment-status { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(0,0,0,0.1); }
.payment-status.paid { background: #10B981; color: white; }
.payment-status.pending { background: #F59E0B; color: white; }
.payment-status.failed { background: #EF4444; color: white; }

/* PASTEL SOFT PILLS */
.soft-pill { padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-block; text-transform: uppercase; letter-spacing: 0.5px;}
.pending { background: #FFFBEB; color: #D97706; } 
.confirmed, .shipped { background: #EFF6FF; color: #2563EB; }
.delivered, .replaced, .refunded { background: #ECFDF5; color: #10B981; } 
.cancelled_refund_pending, .returned_refund_pending, .return_requested, .replacement_requested { background: #FEF2F2; color: #EF4444; }
.rejected, .cancelled { background: #F1F5F9; color: #64748B; }

/* MODAL */
.modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.6); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 999; padding: 20px;}
.modal-card { background: white; width: 100%; max-width: 600px; border-radius: 12px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.15); }
.modal-header { padding: 20px 24px; border-bottom: 1px solid #E2E8F0; display: flex; justify-content: space-between; align-items: center; background: #FAFAFA; border-radius: 12px 12px 0 0;}
.close-btn { background: #E2E8F0; border: none; font-size: 16px; color: #64748B; cursor: pointer; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center;}
.close-btn:hover { background: #FEE2E2; color: #EF4444; }

.modal-body { padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px;}

/* Order Summary Card */
.order-summary-card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.summary-item { display: flex; flex-direction: column; gap: 4px; }
.summary-label { font-size: 11px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px; }
.summary-value { font-size: 13px; color: #0F172A; font-weight: 500; }
.summary-value.price { font-size: 16px; font-weight: 700; color: #0F172A; }
.summary-value.paid { color: #10B981; }
.summary-value.pending { color: #F59E0B; }
.summary-value.failed { color: #EF4444; }

.status-banner { background: #F8FAFC; border: 1px solid #E2E8F0; padding: 12px 16px; border-radius: 8px; display: flex; align-items: center; }

.tracking-zone { display: flex; justify-content: space-between; align-items: center; background: #0F172A; color: white; padding: 12px 16px; border-radius: 8px; }
.track-btn { background: #10B981; color: white; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; }

.alert-strip { background: #FFF7ED; border: 1px dashed #FDBA74; padding: 12px; border-radius: 8px; color: #C2410C; font-size: 13px; }
.alert-strip.error { background: #FEF2F2; border-color: #FCA5A5; color: #DC2626; }
.alert-strip.info { background: #EFF6FF; border-color: #BFDBFE; color: #1E40AF; }
.alert-strip.success { background: #ECFDF5; border-color: #6EE7B7; color: #065F46; }

/* Warehouse-address card nested in pickup-mode alert */
.warehouse-card { margin-top: 10px; padding: 12px; border-radius: 6px; background: #FFFFFF; border: 1px dashed #6EE7B7; font-size: 13px; color: #0F172A; line-height: 1.6; }
.warehouse-line { font-weight: 600; }
.warehouse-note { font-size: 11px; color: #64748B; margin-top: 4px; }

.modal-items-list { border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; }
.m-item { display: flex; gap: 12px; align-items: center; padding-bottom: 12px; border-bottom: 1px dashed #E2E8F0; margin-bottom: 12px; }
.m-item:last-child { border: none; padding-bottom: 0; margin-bottom: 0;}
.m-item-img { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; border: 1px solid #E2E8F0; }
.m-item-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.item-name { font-size: 13px; color: #0F172A; font-weight: 500;}
.item-price-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.item-price { font-size: 12px; color: #475569; }
.item-total { font-size: 13px; color: #0F172A; font-weight: 600; }

/* Timeline */
.timeline-section { border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; background: #FAFAFA; }
.timeline { display: flex; flex-direction: column; gap: 12px; position: relative; }
.timeline::before { content: ''; position: absolute; left: 20px; top: 0; bottom: 0; width: 2px; background: #E2E8F0; }
.timeline-item { display: flex; gap: 12px; position: relative; z-index: 1; opacity: 0.6; transition: opacity 0.3s; }
.timeline-item.current { opacity: 1; }
.timeline-item.completed { opacity: 1; }
.timeline-marker { width: 12px; height: 12px; border-radius: 50%; border: 3px solid white; flex-shrink: 0; margin-top: 2px; background: #CBD5E1; box-shadow: 0 0 0 2px #E2E8F0; }
.timeline-marker.completed { background: #10B981; box-shadow: 0 0 0 2px #10B981; }
.timeline-marker.current { background: #0F172A; box-shadow: 0 0 0 2px #0F172A; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 2px #0F172A; } 50% { box-shadow: 0 0 0 6px rgba(15,23,42,0.3); } }
.timeline-content { flex: 1; min-width: 0; }
.timeline-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.timeline-icon { font-size: 14px; }
.timeline-label { font-size: 13px; font-weight: 500; color: #0F172A; }
.timeline-time { font-size: 11px; color: #64748B; margin-left: auto; }
.timeline-reason { font-size: 12px; color: #EF4444; margin: 0; padding: 8px; background: #FEF2F2; border-radius: 6px; border: 1px solid #FECACA; }

/* Address Card */
.address-card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; }

.modal-action-zone { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; }
.btn-group { display: flex; gap: 10px; }
.w-100 { width: 100%; box-sizing: border-box; }
.btn-outline, .btn-danger-outline, .btn-primary { padding: 10px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid; font-family: inherit; transition: 0.2s;}
.btn-outline { background: white; border-color: #CBD5E1; color: #334155; }
.btn-outline:hover { background: #F1F5F9; }
.btn-danger-outline { background: white; border-color: #FECACA; color: #EF4444; }
.btn-danger-outline:hover { background: #FEF2F2; }
.btn-primary { background: #0F172A; border-color: #0F172A; color: white; }
.btn-primary:hover { background: #334155; }

.request-form-box { margin-top: 16px; padding-top: 16px; border-top: 1px dashed #CBD5E1; }
.return-items-selection { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; max-height: 120px; overflow-y: auto; background: white; padding: 10px; border: 1px solid #E2E8F0; border-radius: 6px;}
.return-checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; cursor: pointer;}
.return-checkbox-label input { accent-color: #0F172A; }
.clean-input { width: 100%; border: 1px solid #CBD5E1; border-radius: 6px; padding: 10px; font-family: inherit; font-size: 13px; outline: none; resize: none; height: 80px; box-sizing: border-box;}
.clean-input:focus { border-color: #0F172A; }

.btn-danger { background: #DC2626; border-color: #DC2626; color: white; padding: 10px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; font-family: inherit; transition: 0.2s; }
.btn-danger:hover { background: #B91C1C; }
.btn-danger:disabled { background: #FCA5A5; cursor: not-allowed; opacity: 0.6; }

@media (max-width: 768px) {
  .vendora-page { padding: 80px 12px 40px; }
  .orders-hub { max-width: 100%; }
  .toolbar { padding: 12px 16px; gap: 10px; }
  .search-box { max-width: 100%; }
  .filter-scroll { gap: 6px; }
  .filter-pill { padding: 5px 10px; font-size: 11px; }
  .vendora-table { min-width: auto; }
  .vendora-table th { padding: 8px 10px; font-size: 10px; letter-spacing: 0.3px; }
  .vendora-table td { padding: 10px; font-size: 12px; }
  .vendora-table th:nth-child(4),
  .vendora-table td:nth-child(4),
  .vendora-table th:nth-child(5),
  .vendora-table td:nth-child(5) { display: none; }
  .id-col { font-size: 11px; }
  .text-sub { font-size: 11px; }
  .truncate { font-size: 11px; }
  .items-col { max-width: 150px; }
  .manage-btn { padding: 4px 10px; font-size: 11px; }
  .modal-card { max-width: 95vw; border-radius: 8px; }
  .modal-body { padding: 16px; gap: 14px; }
  .summary-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .btn-group { flex-direction: column; }
}
</style>