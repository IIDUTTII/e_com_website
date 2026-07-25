<script setup>
import { ref, computed, watch, onUnmounted, onMounted } from 'vue'
import { db } from '../../firebase.js'
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore'
import {
  confirmOrderInDb, rejectOrderInDb, shipOrderInDb, markOrderDeliveredInDb,
  processRefundInDb, approveReturnInDb, rejectReturnInDb,
  approveReplacementInDb, markReplacedInDb, rejectReplacementInDb,
  approveRefund, rejectRefund, completeRefund,
  formatOrderStatus
} from '../db.js'

const props = defineProps({ userRole: { type: String, default: 'user' } })

const ordersList = ref([])
const searchQ = ref('')
const activeFilter = ref('all')
const dateFilter = ref('')
const selected = ref(null)
const loading = ref(false)
const error = ref('')
const loadLimit = ref(15)
const hasMore = ref(false)

const rejectionComment = ref('')
const trackingId = ref('')
const returnRejectReason = ref('')
const actionBusy = ref(false)
let _unsub = null

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

const onFilterEvent = (evt = null) => {
  const f = sessionStorage.getItem('adminOrderFilter')
  const nextFilter = f || evt?.detail?.filter
  if (nextFilter) {
    activeFilter.value = nextFilter
    sessionStorage.removeItem('adminOrderFilter')
  }
}

onMounted(() => {
  onFilterEvent()
  window.addEventListener('apply-order-filter', onFilterEvent)
  subscribeOrders()
})

watch(loadLimit, () => {
  subscribeOrders()
}, { immediate: false })

function subscribeOrders() {
  if (_unsub) _unsub()
  loading.value = true
  error.value = ''

  /* Query by __name__ (doc ID) to avoid mixed-type index issues.
     This guarantees ALL orders are fetched. For auto-generated IDs
     this is roughly newest-first. We re-sort client-side below.   */
  const q = query(
    collection(db, 'orders'),
    orderBy('__name__', 'desc'),
    limit(loadLimit.value)
  )

  _unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    // Re-sort the fetched batch by updatedAt / createdAt for display
    docs.sort((a, b) => getSortTime(b) - getSortTime(a))
    ordersList.value = docs
    hasMore.value = snap.docs.length >= loadLimit.value
    loading.value = false

    if (selected.value) {
      const fresh = ordersList.value.find(o => o.id === selected.value.id)
      if (fresh) selected.value = fresh
    }
  }, (err) => {
    loading.value = false
    error.value = 'Failed to load orders: ' + err.message
    console.error('Orders subscription error:', err)
  })
}

onUnmounted(() => {
  if (_unsub) _unsub()
  window.removeEventListener('apply-order-filter', onFilterEvent)
})

const filteredOrders = computed(() => {
  let list = ordersList.value

  if (activeFilter.value === 'pending') list = list.filter(o => o.shippingStatus === 'pending')
  else if (activeFilter.value === 'confirmed') list = list.filter(o => o.shippingStatus === 'confirmed')
  else if (activeFilter.value === 'shipped') list = list.filter(o => o.shippingStatus === 'shipped')
  else if (activeFilter.value === 'delivered') list = list.filter(o => o.shippingStatus === 'delivered')
  else if (activeFilter.value === 'returns') list = list.filter(o => ['return_requested', 'returned_refund_pending', 'replacement_requested', 'replacement_approved', 'replaced'].includes(o.shippingStatus))
  else if (activeFilter.value === 'cancelled') list = list.filter(o => ['rejected', 'cancelled', 'cancelled_refund_pending', 'refunded'].includes(o.shippingStatus))
  else if (activeFilter.value === 'refund_requested') list = list.filter(o => o.refund_status === 'requested')
  else if (activeFilter.value === 'refund_approved') list = list.filter(o => o.refund_status === 'approved')
  else if (activeFilter.value === 'refund_completed') list = list.filter(o => o.refund_status === 'completed')

  if (dateFilter.value) {
    list = list.filter(o => getOrderDateInputValue(o) === dateFilter.value)
  }

  if (searchQ.value.trim()) {
    const q = searchQ.value.toLowerCase()
    list = list.filter(o =>
      (o.id || '').toLowerCase().includes(q) ||
      (o.items || []).some(item => (item.name || '').toLowerCase().includes(q))
    )
  }

  return list
})

const openOrder = (o) => {
  selected.value = o
  rejectionComment.value = ''
  trackingId.value = ''
  returnRejectReason.value = ''
}

const closeOrder = () => {
  selected.value = null
}

const getOrderCreatedDate = (order) => {
  return toDate(order?.createdAt)
}

const getOrderDateInputValue = (order) => {
  const date = getOrderCreatedDate(order)
  if (!date) return ''
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().slice(0, 10)
}

const runAction = async (fn, statusUpdate) => {
  actionBusy.value = true
  try {
    await fn()
    if (statusUpdate && selected.value) selected.value.shippingStatus = statusUpdate
  } catch (e) {
    alert(e.message)
  } finally {
    actionBusy.value = false
  }
}

const handleConfirm = () => runAction(() => confirmOrderInDb(selected.value.id), 'confirmed')
const handleShip = () => {
  if (!trackingId.value.trim()) return alert('Enter AWB')
  runAction(() => shipOrderInDb(selected.value.id, trackingId.value), 'shipped')
}
const handleDelivered = () => runAction(() => markOrderDeliveredInDb(selected.value.id), 'delivered')
const handleReject = () => {
  if (!rejectionComment.value.trim()) return alert('Reason?')
  runAction(() => rejectOrderInDb(selected.value.id, rejectionComment.value))
}

const handleProcessRefund = () => {
  if (confirm('Processed refund in bank?')) runAction(() => processRefundInDb(selected.value.id), 'refunded')
}
const handleApproveReturn = () => runAction(() => approveReturnInDb(selected.value.id, selected.value.paymentMethod))
const handleRejectReturn = () => {
  if (!returnRejectReason.value.trim()) return alert('Reason?')
  runAction(() => rejectReturnInDb(selected.value.id, returnRejectReason.value), 'delivered')
}
const handleApproveReplacement = () => runAction(() => approveReplacementInDb(selected.value.id), 'replacement_approved')
const handleRejectReplacement = () => {
  if (!returnRejectReason.value.trim()) return alert('Reason?')
  runAction(() => rejectReplacementInDb(selected.value.id, returnRejectReason.value), 'delivered')
}
const handleMarkReplaced = () => {
  if (!trackingId.value.trim()) return alert('New AWB?')
  runAction(() => markReplacedInDb(selected.value.id, trackingId.value), 'replaced')
}

const handleApproveRefund = async () => {
  if (!confirm(`✅ Approve refund of ${money(selected.value?.amount)} for order ${selected.value?.id}?`)) return
  await runAction(() => approveRefund(selected.value.id))
}

const handleRejectRefund = async () => {
  const reason = prompt('❌ Why are you rejecting this refund request?')
  if (!reason || !reason.trim()) return
  await runAction(() => rejectRefund(selected.value.id, reason.trim()))
}

const handleCompleteRefund = async () => {
  if (!confirm(`💸 Confirm that ${money(selected.value?.amount)} has been refunded to the customer?`)) return
  await runAction(() => completeRefund(selected.value.id), 'refunded')
}

const fmtDate = (ts) => {
  const d = toDate(ts)
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'
}

const fmtDateTime = (ts) => {
  const d = toDate(ts)
  return d ? d.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'
}

const money = (val) => {
  const n = Number(val)
  return isNaN(n) ? '₹N/A' : `₹${n.toLocaleString('en-IN')}`
}

const getOrderTimeline = (order) => {
  if (!order) return []
  const events = []

  if (order.createdAt) {
    events.push({ label: 'Order Placed', time: order.createdAt, icon: '📦', status: 'completed' })
  }

  if (order.paymentMethod === 'online' && order.paymentStatus === 'paid') {
    events.push({ label: 'Payment Confirmed', time: order.updatedAt || order.createdAt, icon: '💳', status: 'completed' })
  }

  if (order.confirmedAt) {
    events.push({
      label: 'Confirmed by Admin',
      time: order.confirmedAt,
      icon: '✅',
      status: ['confirmed', 'shipped', 'delivered'].includes(order.shippingStatus) ? 'completed' : 'current'
    })
  }

  if (order.shippedAt || (order.trackingId && order.trackingId !== 'PENDING_DISPATCH')) {
    events.push({
      label: 'Shipped',
      time: order.shippedAt,
      icon: '🚚',
      status: ['shipped', 'delivered'].includes(order.shippingStatus) ? 'completed' : 'current'
    })
  }

  if (order.deliveredAt) {
    events.push({ label: 'Delivered', time: order.deliveredAt, icon: '📦', status: 'completed' })
  }

  if (order.cancelledAt) {
    events.push({ label: 'Cancelled', time: order.cancelledAt, icon: '❌', status: 'completed', reason: order.cancelReason || order.adminComment })
  }

  if (order.refundedAt) {
    events.push({ label: 'Refunded', time: order.refundedAt, icon: '💰', status: 'completed' })
  }

  if (order.shippingStatus === 'return_requested') {
    events.push({ label: 'Return Requested', time: order.updatedAt, icon: '↩️', status: 'current' })
  }

  if (order.shippingStatus === 'replacement_requested') {
    events.push({ label: 'Replacement Requested', time: order.updatedAt, icon: '🔄', status: 'current' })
  }

  if (order.shippingStatus === 'replacement_approved') {
    events.push({ label: 'Replacement Approved', time: order.updatedAt, icon: '✅', status: 'current' })
  }

  if (order.shippingStatus === 'replaced') {
    events.push({ label: 'Replaced', time: order.updatedAt, icon: '🔄', status: 'completed' })
  }

  return events
}
</script>

<template>
  <div class="vendora-page">
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
    </div>

    <div v-else class="orders-hub fade-in">
      <div class="table-card">
        <div class="toolbar">
          <div class="search-row">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input v-model="searchQ" placeholder="Search product or Order ID..." />
            </div>
            <div class="date-box">
              <input type="date" v-model="dateFilter" class="clean-input" />
              <button v-if="dateFilter" class="clear-date" @click="dateFilter = ''">✕</button>
            </div>
          </div>

          <div class="filter-scroll">
            <button :class="['filter-pill', { active: activeFilter === 'all' }]" @click="activeFilter = 'all'">All</button>
            <button :class="['filter-pill', { active: activeFilter === 'pending' }]" @click="activeFilter = 'pending'">Pending</button>
            <button :class="['filter-pill', { active: activeFilter === 'confirmed' }]" @click="activeFilter = 'confirmed'">Confirmed</button>
            <button :class="['filter-pill', { active: activeFilter === 'shipped' }]" @click="activeFilter = 'shipped'">Shipped</button>
            <button :class="['filter-pill', { active: activeFilter === 'delivered' }]" @click="activeFilter = 'delivered'">Delivered</button>
            <button :class="['filter-pill', { active: activeFilter === 'returns' }]" @click="activeFilter = 'returns'">Returns</button>
            <button :class="['filter-pill', { active: activeFilter === 'cancelled' }]" @click="activeFilter = 'cancelled'">Cancelled</button>
            <button :class="['filter-pill', { active: activeFilter === 'refund_requested' }]" @click="activeFilter = 'refund_requested'">Refund Req</button>
            <button :class="['filter-pill', { active: activeFilter === 'refund_approved' }]" @click="activeFilter = 'refund_approved'">Refund Appr</button>
            <button :class="['filter-pill', { active: activeFilter === 'refund_completed' }]" @click="activeFilter = 'refund_completed'">Refund Done</button>
          </div>
        </div>

        <div v-if="error" class="error-banner">{{ error }}</div>

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
              <tr v-if="filteredOrders.length === 0">
                <td colspan="7" class="empty-state">No orders found.</td>
              </tr>
              <tr v-for="order in filteredOrders" :key="order.id">
                <td class="id-col">#{{ (order.id || 'UNKNOWN').slice(0, 8).toUpperCase() }}</td>
                <td class="text-sub">{{ fmtDateTime(order.createdAt) }}</td>
                <td class="items-col">
                  <div class="item-stack">
                    <span v-for="(item, idx) in (order.items || []).slice(0, 2)" :key="idx" class="truncate">
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
                    <span v-if="order.paymentStatus" class="payment-status" :class="order.paymentStatus">{{ order.paymentStatus }}</span>
                  </span>
                </td>
                <td><span :class="['soft-pill', order.shippingStatus || 'pending']">{{ formatOrderStatus(order.shippingStatus || 'pending') }}</span></td>
                <td style="text-align: right;"><button class="manage-btn" @click="openOrder(order)">Details</button></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Load More -->
        <div class="load-more-zone" v-if="hasMore">
          <button class="btn-load" @click="loadLimit += 10">Load 10 more orders</button>
        </div>
      </div>
    </div>

    <!-- ADMIN MODAL -->
    <Teleport to="body">
      <div v-if="selected" class="modal-overlay" @click.self="closeOrder">
        <div class="modal-card slide-up">
          <div class="modal-header">
            <div>
              <h3 style="margin: 0 0 4px; font-size: 16px; color: #0F172A;">Order #{{ (selected.id || 'UNKNOWN').toUpperCase() }}</h3>
              <p style="margin: 0; font-size: 13px; color: #64748B;">{{ fmtDateTime(selected.createdAt) }} • {{ (selected.paymentMethod || 'N/A').toUpperCase() }} • {{ selected.paymentStatus || 'pending' }}</p>
            </div>
            <button class="close-btn" @click="closeOrder">✕</button>
          </div>

          <div class="modal-body">
            <!-- Customer Info -->
            <div class="info-card">
              <h4 style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #94A3B8;">Customer Info</h4>
              <strong style="font-size: 14px; color: #0F172A;">{{ selected.customerName || 'N/A' }}</strong>
              <p style="margin: 4px 0; font-size: 13px; color: #475569;">📞 {{ selected.phone || 'N/A' }}</p>
              <p style="margin: 8px 0 0; padding-top: 8px; border-top: 1px dashed #E2E8F0; font-size: 13px; color: #64748B;">{{ selected.address || 'N/A' }}</p>
            </div>

            <!-- Order Items -->
            <div class="items-card">
              <h4 style="margin: 0 0 12px; font-size: 12px; text-transform: uppercase; color: #94A3B8;">Ordered Items</h4>
              <div v-for="(item, idx) in (selected.items || [])" :key="idx" class="m-item">
                <img v-if="item.imageUrl" :src="item.imageUrl" class="m-item-img" />
                <div v-else class="m-item-img" style="display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#94a3b8;font-size:10px;">N/A</div>
                <div class="m-item-info">
                  <span class="item-name">{{ item.name || 'Unnamed Item' }}</span>
                  <span class="text-sub">{{ item.variant || item.weight || 'Standard' }}</span>
                </div>
                <span class="item-price">Qty: {{ item.quantity || 0 }} × {{ money(item.price) }}</span>
              </div>
              <div v-if="!(selected.items || []).length" class="text-sub" style="padding: 8px 0;">No items in this order.</div>
            </div>

            <!-- Action Zone -->
            <div class="action-zone">
              <div style="display: flex; justify-content: space-between; margin-bottom: 16px; align-items: center;">
                <span style="font-size: 13px; font-weight: 500; color: #64748B;">Status:</span>
                <span :class="['soft-pill', selected.shippingStatus]">{{ (selected.shippingStatus || 'pending').replace(/_/g, ' ') }}</span>
              </div>

              <!-- STATE MACHINE -->
              <div v-if="(selected.shippingStatus || 'pending') === 'pending'" class="strict-actions">
                <button class="btn-primary w-100" @click="handleConfirm" :disabled="actionBusy">✓ Confirm Order</button>
                <div class="reject-box">
                  <input v-model="rejectionComment" placeholder="Reason for rejection..." class="clean-input" />
                  <button class="btn-danger-outline" @click="handleReject" :disabled="actionBusy">✕ Reject Order</button>
                </div>
              </div>

              <div v-else-if="selected.shippingStatus === 'confirmed'" class="strict-actions">
                <input v-model="trackingId" placeholder="Enter Courier Tracking AWB..." class="clean-input w-100" style="margin-bottom: 10px;" />
                <button class="btn-primary w-100" @click="handleShip" :disabled="actionBusy">🚀 Mark as Shipped</button>
              </div>

              <div v-else-if="selected.shippingStatus === 'shipped'" class="strict-actions">
                <p class="text-sub" style="margin: 0 0 10px;">Tracking AWB: <strong>{{ selected.trackingId || 'N/A' }}</strong></p>
                <button class="btn-success w-100" @click="handleDelivered" :disabled="actionBusy">📦 Mark as Delivered</button>
              </div>

              <div v-else-if="['cancelled_refund_pending', 'returned_refund_pending'].includes(selected.shippingStatus)" class="strict-actions alert-zone">
                <p style="margin: 0 0 10px;">⚠️ Customer is waiting for a refund of <strong>{{ money(selected.amount) }}</strong>.</p>
                <button class="btn-success w-100" @click="handleProcessRefund" :disabled="actionBusy">💸 Mark Refund Processed</button>
              </div>

              <!-- Return Requested -->
              <div v-else-if="selected.shippingStatus === 'return_requested'" class="strict-actions alert-zone">
                <p style="margin: 0 0 4px;"><strong>Return Reason:</strong> {{ selected.returnReason || 'N/A' }}</p>
                <div v-if="selected.returnRequestedItems" style="margin-bottom: 12px;">
                  <strong style="font-size: 12px; color: #B91C1C;">Items to Return:</strong>
                  <ul style="margin: 4px 0 0 16px; padding: 0; font-size: 12px; color: #7F1D1D;">
                    <li v-for="i in selected.returnRequestedItems" :key="i">{{ i }}</li>
                  </ul>
                </div>

                <button class="btn-success w-100" style="margin-bottom: 10px;" @click="handleApproveReturn" :disabled="actionBusy">✓ Approve Return</button>
                <div class="reject-box">
                  <input v-model="returnRejectReason" placeholder="Reason to decline return..." class="clean-input" />
                  <button class="btn-danger-outline" @click="handleRejectReturn" :disabled="actionBusy">✕ Decline Return</button>
                </div>
              </div>

              <!-- Refund Management -->
              <div v-else-if="selected.refund_status === 'requested'" class="strict-actions alert-zone">
                <p style="margin: 0 0 4px;"><strong>💳 Refund Request</strong></p>
                <p style="margin: 0 0 4px; font-size: 13px;">Reason: {{ selected.refund_reason || 'No reason provided' }}</p>
                <p style="margin: 0 0 12px; font-size: 12px; color: #64748B;">
                  Customer: {{ selected.customerName || 'N/A' }} • Amount: <strong>{{ money(selected.amount) }}</strong>
                </p>
                <div class="btn-group">
                  <button class="btn-success w-100" @click="handleApproveRefund" :disabled="actionBusy">✅ Approve Refund</button>
                  <button class="btn-danger-outline w-100" @click="handleRejectRefund" :disabled="actionBusy">❌ Reject Refund</button>
                </div>
              </div>

              <div v-else-if="selected.refund_status === 'approved'" class="strict-actions" style="background: #ECFDF5; border: 1px solid #6EE7B7;">
                <p style="margin: 0 0 10px;">✅ Refund <strong>approved</strong> for {{ money(selected.amount) }}</p>
                <p style="margin: 0 0 12px; font-size: 12px; color: #64748B;">
                  Approved by: {{ selected.refund_approved_by || 'Admin' }}
                </p>
                <button class="btn-success w-100" @click="handleCompleteRefund" :disabled="actionBusy">💸 Mark Refund Completed</button>
              </div>

              <div v-else-if="selected.refund_status === 'completed'" class="terminal-state" style="background: #ECFDF5; border: 1px solid #6EE7B7;">
                <p style="margin: 0; color: #065F46;">✅ Refund <strong>completed</strong> for {{ money(selected.amount) }}</p>
                <p v-if="selected.refunded_at" style="margin: 4px 0 0; font-size: 12px; color: #64748B;">
                  Refunded on: {{ fmtDate(selected.refunded_at) }}
                </p>
              </div>

              <div v-else-if="selected.refund_status === 'rejected'" class="terminal-state" style="background: #FEF2F2; border: 1px solid #FCA5A5;">
                <p style="margin: 0; color: #DC2626;">❌ Refund <strong>rejected</strong></p>
                <p v-if="selected.refund_reject_reason" style="margin: 4px 0 0; font-size: 12px; color: #64748B;">
                  Reason: {{ selected.refund_reject_reason }}
                </p>
              </div>

              <!-- Replacement -->
              <div v-else-if="selected.shippingStatus === 'replacement_requested'" class="strict-actions alert-zone">
                <p style="margin: 0 0 4px;"><strong>Reason:</strong> {{ selected.replacementReason || 'N/A' }}</p>
                <div v-if="selected.returnRequestedItems" style="margin-bottom: 12px;">
                  <strong style="font-size: 12px; color: #B91C1C;">Items to Replace:</strong>
                  <ul style="margin: 4px 0 0 16px; padding: 0; font-size: 12px; color: #7F1D1D;">
                    <li v-for="i in selected.returnRequestedItems" :key="i">{{ i }}</li>
                  </ul>
                </div>

                <button class="btn-success w-100" style="margin-bottom: 10px;" @click="handleApproveReplacement" :disabled="actionBusy">✓ Approve Replacement</button>
                <div class="reject-box">
                  <input v-model="returnRejectReason" placeholder="Reason to decline replacement..." class="clean-input" />
                  <button class="btn-danger-outline" @click="handleRejectReplacement" :disabled="actionBusy">✕ Decline Replacement</button>
                </div>
              </div>

              <div v-else-if="selected.shippingStatus === 'replacement_approved'" class="strict-actions">
                <input v-model="trackingId" placeholder="New Replacement AWB..." class="clean-input w-100" style="margin-bottom: 10px;" />
                <button class="btn-primary w-100" @click="handleMarkReplaced" :disabled="actionBusy">🚀 Mark Replacement Shipped</button>
              </div>

              <!-- Terminal States -->
              <div v-else-if="['delivered', 'refunded', 'replaced', 'cancelled', 'rejected', 'cancelled_refund_pending'].includes(selected.shippingStatus)" class="terminal-state">
                <p style="margin: 0;">This order has reached a final state.</p>
                <p v-if="selected.cancelReason" style="margin: 4px 0 0; font-size: 12px; color: #EF4444;"><strong>Cancellation Reason:</strong> {{ selected.cancelReason }}</p>
                <p v-if="selected.adminComment" style="margin: 4px 0 0; font-size: 12px; color: #64748B;">Admin Note: {{ selected.adminComment }}</p>
              </div>

            </div><!-- /action-zone -->
          </div><!-- /modal-body -->
        </div><!-- /modal-card -->
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

.vendora-page { min-height: 100vh; background-color: #F8FAFC; padding: 0; font-family: 'Inter', sans-serif; color: #334155; }
.loading-state { display: flex; justify-content: center; height: 50vh; align-items: center; }
.spinner { width: 30px; height: 30px; border: 3px solid #E2E8F0; border-top-color: #0F172A; border-radius: 50%; animation: rot 0.8s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }
.fade-in { animation: fi 0.3s ease; }
@keyframes fi { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.slide-up { animation: sUp 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes sUp { from { transform: translateY(20px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }

.orders-hub { width: 100%; }
.table-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; }

/* TOOLBAR */
.toolbar { padding: 16px 24px; border-bottom: 1px solid #E2E8F0; display: flex; flex-direction: column; gap: 16px; }
.search-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.search-box { position: relative; display: flex; align-items: center; width: 100%; max-width: 400px; }
.search-icon { position: absolute; left: 12px; font-size: 12px; color: #94A3B8; }
.search-box input { width: 100%; padding: 10px 12px 10px 32px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; outline: none; color: #334155; font-family: inherit; }
.search-box input:focus { border-color: #0F172A; }

.date-box { position: relative; display: flex; align-items: center; }
.date-box input { padding: 9px 28px 9px 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; color: #334155; font-family: inherit; cursor: pointer; }
.clear-date { position: absolute; right: 6px; background: none; border: none; color: #94A3B8; cursor: pointer; font-size: 11px; padding: 2px 4px; }

.filter-scroll { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.filter-scroll::-webkit-scrollbar { display: none; }
.filter-pill { background: transparent; border: 1px solid #E2E8F0; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; color: #64748B; cursor: pointer; white-space: nowrap; transition: 0.2s; }
.filter-pill:hover { border-color: #0F172A; color: #0F172A; }
.filter-pill.active { background: #0F172A; color: white; border-color: #0F172A; }

.error-banner { padding: 12px 24px; background: #FEF2F2; color: #B91C1C; font-size: 13px; border-bottom: 1px solid #FECACA; }

/* TABLE */
.table-responsive { overflow-x: auto; }
.vendora-table { width: 100%; border-collapse: collapse; min-width: 900px; table-layout: auto; }
.vendora-table th { padding: 10px 14px; background: #FAFAFA; border-bottom: 1px solid #E2E8F0; font-size: 11px; font-weight: 500; color: #64748B; text-align: left; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
.vendora-table td { padding: 12px 14px; border-bottom: 1px solid #F1F5F9; font-size: 12px; color: #334155; font-weight: 400; vertical-align: middle; }
.vendora-table th:nth-child(2), .vendora-table td:nth-child(2) { white-space: nowrap; }
.vendora-table tr:hover td { background-color: #F8FAFC; }

.id-col { font-family: monospace; color: #0F172A; font-weight: 600; font-size: 11px; }
.text-sub { color: #64748B; font-size: 11px; }
.items-col { max-width: 180px; }
.item-stack { display: flex; flex-direction: column; gap: 2px; }
.truncate { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
.price-col { color: #0F172A; font-weight: 600; }
.empty-state { text-align: center; color: #94A3B8; padding: 32px !important; }

.manage-btn { background: white; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 12px; font-size: 11px; font-weight: 500; cursor: pointer; color: #0F172A; transition: 0.2s; font-family: inherit; }
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
.soft-pill { padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-block; text-transform: uppercase; letter-spacing: 0.5px; }
.pending { background: #FFFBEB; color: #D97706; }
.confirmed, .shipped { background: #EFF6FF; color: #2563EB; }
.delivered, .replaced, .refunded { background: #ECFDF5; color: #10B981; }
.cancelled_refund_pending, .returned_refund_pending, .return_requested, .replacement_requested { background: #FEF2F2; color: #EF4444; }
.rejected, .cancelled { background: #F1F5F9; color: #64748B; }

/* Load More */
.load-more-zone { display: flex; justify-content: center; padding: 24px 0; margin-top: 10px; }
.btn-load { background: white; border: 2px solid #cbd5e1; padding: 12px 24px; border-radius: 30px; font-weight: 700; cursor: pointer; color: #0f172a; transition: 0.2s; }
.btn-load:hover { border-color: #0F2A1F; color: #0F2A1F; background: #f8fafc; }

/* MODAL */
.modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.6); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 999; padding: 20px; }
.modal-card { background: white; width: 100%; max-width: 600px; border-radius: 12px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.15); }
.modal-header { padding: 20px 24px; border-bottom: 1px solid #E2E8F0; display: flex; justify-content: space-between; align-items: center; background: #FAFAFA; border-radius: 12px 12px 0 0; }
.close-btn { background: #E2E8F0; border: none; font-size: 16px; color: #64748B; cursor: pointer; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.close-btn:hover { background: #FEE2E2; color: #EF4444; }

.modal-body { padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
.info-card { background: #F8FAFC; border: 1px solid #E2E8F0; padding: 16px; border-radius: 8px; }
.items-card { border: 1px solid #E2E8F0; padding: 16px; border-radius: 8px; }
.m-item { display: flex; gap: 12px; align-items: center; padding-bottom: 12px; border-bottom: 1px dashed #E2E8F0; margin-bottom: 12px; }
.m-item:last-child { border: none; padding-bottom: 0; margin-bottom: 0; }
.m-item-img { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; border: 1px solid #E2E8F0; }
.m-item-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.item-name { font-size: 13px; color: #0F172A; font-weight: 500; }
.item-price { font-size: 13px; color: #475569; }

.action-zone { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; }
.alert-zone { background: #FFF1F2 !important; border: 1px dashed #FCA5A5 !important; }

.reject-box { display: flex; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #CBD5E1; }
.btn-group { display: flex; gap: 10px; }
.w-100 { width: 100%; box-sizing: border-box; }
.clean-input { border: 1px solid #CBD5E1; border-radius: 6px; padding: 10px; font-family: inherit; font-size: 13px; outline: none; flex: 1; }
.clean-input:focus { border-color: #0F172A; }

.btn-outline, .btn-danger-outline, .btn-primary, .btn-success { padding: 10px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; font-family: inherit; transition: 0.2s; }
.btn-outline { background: white; border-color: #CBD5E1; color: #334155; }
.btn-danger-outline { background: white; border-color: #FECACA; color: #EF4444; }
.btn-primary { background: #0F172A; border-color: #0F172A; color: white; }
.btn-success { background: #10B981; border-color: #10B981; color: white; }
.btn-primary:hover { background: #334155; }

.terminal-state { text-align: center; padding: 12px; background: #F1F5F9; border-radius: 6px; color: #475569; font-size: 13px; font-weight: 500; }

@media (max-width: 900px) {
  .vendora-page { margin: 0; }
  .orders-hub { padding: 0; }
}
@media (max-width: 768px) {
  .vendora-page { margin: 0; }
  .orders-hub { padding: 0; }
  .toolbar { padding: 12px 16px; gap: 10px; }
  .search-row { flex-direction: column; align-items: stretch; }
  .search-box { max-width: 100%; }
  .date-box { width: 100%; }
  .date-box input { width: 100%; }
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
  .btn-group { flex-direction: column; }
}
</style>