<script setup>
import { ref, computed, watch, onUnmounted, onMounted } from 'vue'
import { db } from '../../firebase.js'
import { collection, query, orderBy, onSnapshot, limit, getDoc, doc } from 'firebase/firestore'
import {
  confirmOrderInDb, rejectOrderInDb, shipOrderInDb, markOrderDeliveredInDb,
  processRefundInDb, approveReturnInDb, rejectReturnInDb,
  approveReplacementInDb, markReplacedInDb, rejectReplacementInDb,
  approveRefund, rejectRefund, completeRefund,
  formatOrderStatus,
  approveOrder, shipOrder, deliverOrder, cancelOrderFSM, markRefundedFSM,
  approveReturnFSM, rejectReturnFSM, requestReturnFSM, fetchOrderHistory,
  approveReplacementFSM, markReplacedFSM, rejectReplacementFSM,
  fetchUserProfile, setPickupModeForOrder, WAREHOUSE_ADDRESS,
} from '../db.js'

const props = defineProps({ userRole: { type: String, default: 'user' } })

const ordersList = ref([])
const searchQ = ref('')
const activeFilter = ref('all')
const dateFilter = ref('')
const selected = ref(null)
const loading = ref(false)
const error = ref('')
const lookupNote = ref('')
/* Orders that the admin manually looked up by ID, kept as full
   objects so they survive the next onSnapshot refresh and the row
   never disappears from the table. Keyed by id for dedup. */
const pinnedOrders = ref(new Map())
const loadLimit = ref(50)
const hasMore = ref(false)

const rejectionComment = ref('')
const trackingId = ref('')
const returnRejectReason = ref('')
const actionBusy = ref(false)
const refundTxnId = ref('')
const refundNote = ref('')
const refundDateInput = ref('')
const orderHistoryList = ref([])
const orderHistoryLoading = ref(false)
const orderUserProfile = ref(null)
const orderUserProfileLoading = ref(false)
const pickupChoiceNote = ref('')
const pickupChoiceBusy = ref(false)
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

  /* Sort by createdAt descending so the visible list is actually
     newest-first. Single-field descending index is auto-created by
     Firestore, so no manual index is required unless you're using a
     compound query.
     If createdAt is missing on legacy orders they sort last (Firestore
     puts nulls last on desc). */
  const q = query(
    collection(db, 'orders'),
    orderBy('createdAt', 'desc'),
    limit(loadLimit.value)
  )

  _unsub = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    // Tiebreaker: legacy orders without timestamps sink to bottom;
    // identical timestamps break by ID (newest ID convention first).
    docs.sort((a, b) => {
      const ta = getSortTime(a) || 0
      const tb = getSortTime(b) || 0
      if (tb !== ta) return tb - ta
      return (b.id || '').localeCompare(a.id || '')
    })

    /* Merge in any pinned orders (manually looked up by ID) that the
       snapshot didn't include. The pinned orders Map already holds the
       full data so no re-fetch is needed. */
    const seen = new Set(docs.map(d => d.id))
    for (const [id, pinned] of pinnedOrders.value) {
      if (!seen.has(id)) docs.unshift(pinned)
      else {
        /* Keep pinned copy up to date if the snapshot brought newer fields. */
        const i = docs.findIndex(d => d.id === id)
        if (i >= 0) Object.assign(pinned, docs[i])
      }
    }
    docs.sort((a, b) => {
      const ta = getSortTime(a) || 0
      const tb = getSortTime(b) || 0
      if (tb !== ta) return tb - ta
      return (b.id || '').localeCompare(a.id || '')
    })
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

/* Direct order-by-ID lookup. Bypasses the load-limit so we don't
   need to click "Load more" 3-4 times to find an old order.
   The order is PINNED (added to pinnedOrders) so the next onSnapshot
   does not evict it from the table. */
const lookupOrderById = async () => {
  const id = searchQ.value.trim()
  if (!id || id.length < 3) {
    lookupNote.value = 'Type at least 3 characters to lookup.'
    return
  }
  lookupNote.value = ''
  loading.value = true
  try {
    const snap = await getDoc(doc(db, 'orders', id))
    if (!snap.exists()) {
      lookupNote.value = `No order exists with ID "${id}".`
      return
    }
    const order = { id: snap.id, ...snap.data() }
    const idx = ordersList.value.findIndex(o => o.id === id)
    if (idx === -1) ordersList.value.unshift(order)
    else ordersList.value[idx] = order
    /* Pin so the next snapshot refresh keeps it in the list. */
    pinnedOrders.value.set(id, order)
    selected.value = order
    error.value = ''
  } catch (e) {
    lookupNote.value = 'Lookup failed: ' + e.message
  } finally {
    loading.value = false
  }
}

const clearSearch = () => {
  searchQ.value = ''
  lookupNote.value = ''
}

const unpinOrder = (id) => {
  pinnedOrders.value.delete(id)
}

onUnmounted(() => {
  if (_unsub) _unsub()
  window.removeEventListener('apply-order-filter', onFilterEvent)
})

// At-a-glance counts for the quick tiles above the table. These
// reflect only the orders currently loaded into the client (limited
// by loadLimit). They are not full counts.
const isActionNeeded = (o) => {
  const s = o.shippingStatus
  return s === 'return_requested'
    || s === 'replacement_requested'
    || s === 'replacement_approved'
    || s === 'returned_refund_pending'
    || o.refund_status === 'requested'
}
const countActionNeeded = computed(() => ordersList.value.filter(isActionNeeded).length)
const countReturnReq = computed(() => ordersList.value.filter(o => o.shippingStatus === 'return_requested').length)
const countReplaceReq = computed(() => ordersList.value.filter(o => o.shippingStatus === 'replacement_requested').length)
const countRefundReq = computed(() => ordersList.value.filter(o => o.refund_status === 'requested').length)

const filteredOrders = computed(() => {
  let list = ordersList.value

  if (activeFilter.value === 'pending') list = list.filter(o => o.shippingStatus === 'pending')
  else if (activeFilter.value === 'confirmed') list = list.filter(o => o.shippingStatus === 'confirmed')
  else if (activeFilter.value === 'packed') list = list.filter(o => o.shippingStatus === 'packed')
  else if (activeFilter.value === 'shipped') list = list.filter(o => o.shippingStatus === 'shipped')
  else if (activeFilter.value === 'delivered') list = list.filter(o => o.shippingStatus === 'delivered')
  else if (activeFilter.value === 'return_requested')   list = list.filter(o => o.shippingStatus === 'return_requested')
  else if (activeFilter.value === 'replacement_requested') list = list.filter(o => o.shippingStatus === 'replacement_requested')
  else if (activeFilter.value === 'replacement_approved')  list = list.filter(o => o.shippingStatus === 'replacement_approved')
  else if (activeFilter.value === 'replaced')              list = list.filter(o => o.shippingStatus === 'replaced')
  else if (activeFilter.value === 'returned_refund')       list = list.filter(o => o.shippingStatus === 'returned_refund_pending')
  else if (activeFilter.value === 'returns_combined') list = list.filter(o => ['return_requested', 'returned_refund_pending', 'replacement_requested', 'replacement_approved', 'replaced'].includes(o.shippingStatus))
  else if (activeFilter.value === 'cancelled') list = list.filter(o => ['rejected', 'cancelled', 'cancelled_refund_pending', 'refunded'].includes(o.shippingStatus))
  else if (activeFilter.value === 'refund_requested') list = list.filter(o => o.refund_status === 'requested')
  else if (activeFilter.value === 'refund_approved') list = list.filter(o => o.refund_status === 'approved')
  else if (activeFilter.value === 'refund_completed') list = list.filter(o => o.refund_status === 'completed')
  else if (activeFilter.value === 'action_needed') list = list.filter(o => {
    // Customer is waiting on us → surfaced at the top of admin's queue.
    const s = o.shippingStatus
    return s === 'return_requested'
      || s === 'replacement_requested'
      || s === 'replacement_approved'
      || s === 'returned_refund_pending'
      || o.refund_status === 'requested'
  })

  if (dateFilter.value) {
    list = list.filter(o => getOrderDateInputValue(o) === dateFilter.value)
  }

  if (searchQ.value.trim()) {
    const q = searchQ.value.toLowerCase()
    list = list.filter(o => {
      // Match by order ID, item name, customer name, phone, address.
      const items = o.items || []
      return (o.id || '').toLowerCase().includes(q)
        || (o.customerName || '').toLowerCase().includes(q)
        || (o.phone || '').toLowerCase().includes(q)
        || (o.address || '').toLowerCase().includes(q)
        || items.some(item =>
          (item.name || '').toLowerCase().includes(q)
          || (item.variant || '').toLowerCase().includes(q))
    })
  }

  return list
})

const openOrder = (o) => {
  selected.value = o
  rejectionComment.value = ''
  trackingId.value = ''
  returnRejectReason.value = ''
  refundTxnId.value = ''
  refundNote.value = ''
  refundDateInput.value = new Date().toISOString().slice(0, 10)
  pickupChoiceNote.value = ''
  loadHistory(o.id)
  loadOrderUserProfile(o)
}

const closeOrder = () => {
  selected.value = null
  orderHistoryList.value = []
  orderUserProfile.value = null
}

const loadOrderUserProfile = async (order) => {
  if (!order?.userId) {
    orderUserProfile.value = null
    return
  }
  orderUserProfileLoading.value = true
  try {
    const profile = await fetchUserProfile(order.userId)
    orderUserProfile.value = profile
  } catch (e) {
    orderUserProfile.value = null
  } finally {
    orderUserProfileLoading.value = false
  }
}

// ─── Smart customer-name resolver ────────────────────────────────────
// Some older orders don't have a top-level customerName field. We
// pull the name from:
//   1. `users/{uid}.displayName/name/fullName`  (already in orderUserProfile)
//   2. order.customerName
//   3. order.shippingAddress.fullName (structured address)
//   4. first non-empty line of `selected.address` if it looks like "Name\n..."
const addressFirstLine = (addr) => {
  if (!addr) return null
  const first = String(addr).split('\n').map(s => s.trim()).find(Boolean)
  if (!first) return null
  // Heuristic: if it has digits or ZIP/PIN it is NOT a name → don't fake-fill.
  if (/\d/.test(first)) return null
  return first
}
const customerDisplayName = computed(() => {
  const o = selected.value || {}
  const p = orderUserProfile.value || {}
  return (
    p.name ||
    o.customerName ||
    o.shippingAddress?.fullName ||
    o.shippingAddress?.name ||
    addressFirstLine(o.address) ||
    addressFirstLine(o.shippingAddress?.line1) ||
    null
  )
})
const customerDisplayPhone = computed(() => {
  const o = selected.value || {}
  const p = orderUserProfile.value || {}
  return p.phone || o.phone || o.shippingAddress?.phone || null
})

const loadHistory = async (orderId) => {
  if (!orderId) return
  orderHistoryLoading.value = true
  try {
    orderHistoryList.value = await fetchOrderHistory(orderId)
  } catch (e) {
    orderHistoryList.value = []
  } finally {
    orderHistoryLoading.value = false
  }
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

// ─── FSM-aware wrapper ────────────────────────────────────────────────
// Best-effort: try the new /api/order-transition endpoint first so a
// history entry is written. If the endpoint says "transitionNotPermitted"
// we surface that. If the endpoint itself is unreachable (network/401), we
// fall back to the original direct-write function so the workflow still
// works — at the cost of no history for that one action.
/* eslint-disable no-unused-vars */
const withHistory = async ({ fsmCall, fallbackCall, statusUpdate }) => {
  actionBusy.value = true
  try {
    try {
      const out = await fsmCall()
      if (selected.value && out?.toStatus) selected.value.shippingStatus = out.toStatus
      if (selected.value?.id) await loadHistory(selected.value.id)
      return
    } catch (e) {
      const msg = String(e?.message || '')
      // Only treat as a transition-permission failure (use the fallback
      // path only for OTHER errors). Without this guard, ANY non-prefix
      // error (e.g. HTTP 405 from a misconfigured function) would be
      // surfaced to the admin instead of falling back to the direct
      // Firestore write that the FSM-style endpoint was protecting.)
      const isTransitionErr =
        msg.includes('transitionNotPermitted') ||
        msg.includes('invalidTransition')
      if (!isTransitionErr) {
        console.warn('FSM endpoint unavailable, falling back to direct write:', msg)
        // fall through to fallbackCall() below
      } else {
        throw e
      }
    }
    await fallbackCall()
    if (statusUpdate && selected.value) selected.value.shippingStatus = statusUpdate
    if (selected.value?.id) await loadHistory(selected.value.id)
  } catch (e) {
    alert(e.message)
  } finally {
    actionBusy.value = false
  }
}

const handleConfirm = () => withHistory({
  fsmCall: () => approveOrder(selected.value.id),
  fallbackCall: () => confirmOrderInDb(selected.value.id),
  statusUpdate: 'confirmed',
})
const handleShip = () => {
  if (!trackingId.value.trim()) return alert('Enter AWB')
  withHistory({
    fsmCall: () => shipOrder(selected.value.id, 'awb', trackingId.value.trim()),
    fallbackCall: () => shipOrderInDb(selected.value.id, trackingId.value),
    statusUpdate: 'shipped',
  })
}
const handleDelivered = () => withHistory({
  fsmCall: () => deliverOrder(selected.value.id),
  fallbackCall: () => markOrderDeliveredInDb(selected.value.id),
  statusUpdate: 'delivered',
})
const handleReject = () => {
  if (!rejectionComment.value.trim()) return alert('Reason?')
  withHistory({
    fsmCall: () => cancelOrderFSM(selected.value.id, rejectionComment.value),
    fallbackCall: () => rejectOrderInDb(selected.value.id, rejectionComment.value),
    statusUpdate: 'rejected',
  })
}

const handleProcessRefund = () => {
  if (!confirm('Processed refund in bank?')) return
  withHistory({
    fsmCall: () => markRefundedFSM(selected.value.id, {}, ''),
    fallbackCall: () => processRefundInDb(selected.value.id),
    statusUpdate: 'refunded',
  })
}
const handleApproveReturn = () => withHistory({
  fsmCall: () => approveReturnFSM(selected.value.id, ''),
  fallbackCall: () => approveReturnInDb(selected.value.id, selected.value.paymentMethod),
})
const handleRejectReturn = () => {
  if (!returnRejectReason.value.trim()) return alert('Reason?')
  withHistory({
    fsmCall: () => rejectReturnFSM(selected.value.id, returnRejectReason.value),
    fallbackCall: () => rejectReturnInDb(selected.value.id, returnRejectReason.value),
    statusUpdate: 'delivered',
  })
}
const handleApproveReplacement = () => withHistory({
  fsmCall: () => approveReplacementFSM(selected.value.id, ''),
  fallbackCall: () => approveReplacementInDb(selected.value.id),
  statusUpdate: 'replacement_approved',
})
const handleRejectReplacement = () => {
  if (!returnRejectReason.value.trim()) return alert('Reason?')
  withHistory({
    fsmCall: () => rejectReplacementFSM(selected.value.id, returnRejectReason.value),
    fallbackCall: () => rejectReplacementInDb(selected.value.id, returnRejectReason.value),
    statusUpdate: 'rejected',
  })
}
const handleMarkReplaced = () => {
  if (!trackingId.value.trim()) return alert('New AWB?')
  withHistory({
    fsmCall: () => markReplacedFSM(selected.value.id, 'awb', trackingId.value.trim()),
    fallbackCall: () => markReplacedInDb(selected.value.id, trackingId.value),
    statusUpdate: 'replaced',
  })
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
  await withHistory({
    fsmCall: () => markRefundedFSM(selected.value.id, {
      txnId: refundTxnId.value || '',
      processedAt: refundDateInput.value ? new Date(refundDateInput.value) : new Date(),
      note: refundNote.value || '',
      amount: selected.value?.amount || 0,
    }, refundNote.value || ''),
    fallbackCall: () => completeRefund(selected.value.id, {
      txnId: refundTxnId.value || '',
      processedAt: refundDateInput.value ? new Date(refundDateInput.value) : new Date(),
      note: refundNote.value || '',
    }),
    statusUpdate: 'refunded',
  })
}

// ─── Pickup Mode chooser (admin approves replacement/return → asks how to take item back) ─
const handlePickupChoice = async (mode) => {
  if (!selected.value?.id) return
  pickupChoiceBusy.value = true
  try {
    const label = mode === 'pickup' ? 'Reverse Pickup' : 'Self-ship via India Post'
    const note = pickupChoiceNote.value?.trim() || label
    await setPickupModeForOrder(selected.value.id, mode, note)
    if (selected.value) selected.value.pickupMode = mode
    if (selected.value) selected.value.pickupNote = note
    if (selected.value) selected.value.pickupSetAt = new Date().toISOString()
  } catch (e) {
    alert('Failed to set pickup mode: ' + e.message)
  } finally {
    pickupChoiceBusy.value = false
  }
}
const clearPickupChoice = async () => {
  if (!selected.value?.id) return
  pickupChoiceBusy.value = true
  try {
    await setPickupModeForOrder(selected.value.id, 'none')
    if (selected.value) selected.value.pickupMode = null
    if (selected.value) selected.value.pickupNote = null
    if (selected.value) selected.value.pickupSetAt = null
  } catch (e) {
    alert('Failed to clear pickup mode: ' + e.message)
  } finally {
    pickupChoiceBusy.value = false
  }
}
const copyWarehouseAddress = async () => {
  const text = [
    WAREHOUSE_ADDRESS.name,
    WAREHOUSE_ADDRESS.line1,
    WAREHOUSE_ADDRESS.line2,
    `${WAREHOUSE_ADDRESS.country} – ${WAREHOUSE_ADDRESS.pincode}`,
    `Phone: ${WAREHOUSE_ADDRESS.phone}`,
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    alert('Warehouse address copied to clipboard.')
  } catch (e) {
    alert('Copy failed: ' + e.message + '\n\n' + text)
  }
}

const fmtDate = (ts) => {
  const d = toDate(ts)
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'
}

const fmtDateTime = (ts) => {
  const d = toDate(ts)
  return d ? d.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'
}

const formatHistoryArrow = (from, to) => {
  const a = (from || '?').replace(/_/g, ' ')
  const b = (to || '?').replace(/_/g, ' ')
  return `${a} → ${b}`
}

const formatHistoryTitle = (ev) => {
  const titleByAction = {
    approve: '✓ Confirmed',
    pack: '📦 Packed',
    ship: '🚚 Shipped',
    deliver: '✅ Delivered',
    cancel: '❌ Cancelled',
    request_return: '↩️ Return requested',
    approve_return: '↩️ Return approved',
    reject_return: '↩️ Return rejected',
    mark_refunded: '💸 Refunded',
    approve_replacement: '🔁 Replacement approved',
    mark_replaced: '✅ Replacement shipped',
    reject_replacement: '🚫 Replacement rejected',
  }
  return titleByAction[ev.action] || ev.action || 'Event'
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
      <div class="stats-strip">
        <div class="stat-tile" :class="{ active: activeFilter === 'action_needed' }" @click="activeFilter = (activeFilter === 'action_needed' ? 'all' : 'action_needed')" style="cursor: pointer;">
          <span class="stat-num">{{ countActionNeeded }}</span>
          <span class="stat-text">Action Needed</span>
        </div>
        <div class="stat-tile" :class="{ active: activeFilter === 'return_requested' }" @click="activeFilter = (activeFilter === 'return_requested' ? 'all' : 'return_requested')" style="cursor: pointer;">
          <span class="stat-num">{{ countReturnReq }}</span>
          <span class="stat-text">Return Req</span>
        </div>
        <div class="stat-tile" :class="{ active: activeFilter === 'replacement_requested' }" @click="activeFilter = (activeFilter === 'replacement_requested' ? 'all' : 'replacement_requested')" style="cursor: pointer;">
          <span class="stat-num">{{ countReplaceReq }}</span>
          <span class="stat-text">Replace Req</span>
        </div>
        <div class="stat-tile" :class="{ active: activeFilter === 'refund_requested' }" @click="activeFilter = (activeFilter === 'refund_requested' ? 'all' : 'refund_requested')" style="cursor: pointer;">
          <span class="stat-num">{{ countRefundReq }}</span>
          <span class="stat-text">Refund Req</span>
        </div>
        <div class="stat-tile muted">
          <span class="stat-num">{{ ordersList.length }}</span>
          <span class="stat-text">Loaded ({{ hasMore ? 'more available' : 'all' }})</span>
        </div>
      </div>

      <div class="table-card">
        <div class="toolbar">
          <div class="search-row">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input v-model="searchQ" placeholder="Search by Order ID, customer name, product, phone, address…" @keyup.enter="lookupOrderById" />
              <button v-if="searchQ" class="clear-search" @click="clearSearch" title="Clear search">✕</button>
            </div>
            <button class="btn-lookup" @click="lookupOrderById" :disabled="loading || !searchQ.trim()">🔎 Lookup by ID</button>
            <div class="date-box">
              <input type="date" v-model="dateFilter" class="clean-input" />
              <button v-if="dateFilter" class="clear-date" @click="dateFilter = ''">✕</button>
            </div>
          </div>

          <div v-if="lookupNote" class="lookup-note">{{ lookupNote }}</div>

          <div class="filter-scroll">
            <button :class="['filter-pill', { active: activeFilter === 'all' }]" @click="activeFilter = 'all'">All</button>
            <button :class="['filter-pill', 'priority-pill', { active: activeFilter === 'action_needed' }]" @click="activeFilter = 'action_needed'">⚡ Action Needed</button>
            <button :class="['filter-pill', { active: activeFilter === 'pending' }]" @click="activeFilter = 'pending'">Pending</button>
            <button :class="['filter-pill', { active: activeFilter === 'confirmed' }]" @click="activeFilter = 'confirmed'">Confirmed</button>
            <button :class="['filter-pill', { active: activeFilter === 'packed' }]" @click="activeFilter = 'packed'">Packed</button>
            <button :class="['filter-pill', { active: activeFilter === 'shipped' }]" @click="activeFilter = 'shipped'">Shipped</button>
            <button :class="['filter-pill', { active: activeFilter === 'delivered' }]" @click="activeFilter = 'delivered'">Delivered</button>
            <button :class="['filter-pill', { active: activeFilter === 'return_requested' }]" @click="activeFilter = 'return_requested'">↩️ Return Req</button>
            <button :class="['filter-pill', { active: activeFilter === 'replacement_requested' }]" @click="activeFilter = 'replacement_requested'">🔁 Replace Req</button>
            <button :class="['filter-pill', { active: activeFilter === 'replacement_approved' }]" @click="activeFilter = 'replacement_approved'">✅ Replace OK</button>
            <button :class="['filter-pill', { active: activeFilter === 'replaced' }]" @click="activeFilter = 'replaced'">Replaced</button>
            <button :class="['filter-pill', { active: activeFilter === 'returned_refund' }]" @click="activeFilter = 'returned_refund'">↩️ Returned Refund</button>
            <button :class="['filter-pill', { active: activeFilter === 'returns_combined' }]" @click="activeFilter = 'returns_combined'">📦 All Returns</button>
            <button :class="['filter-pill', { active: activeFilter === 'refund_requested' }]" @click="activeFilter = 'refund_requested'">💳 Refund Req</button>
            <button :class="['filter-pill', { active: activeFilter === 'refund_approved' }]" @click="activeFilter = 'refund_approved'">💳 Refund Appr</button>
            <button :class="['filter-pill', { active: activeFilter === 'refund_completed' }]" @click="activeFilter = 'refund_completed'">✅ Refund Done</button>
            <button :class="['filter-pill', { active: activeFilter === 'cancelled' }]" @click="activeFilter = 'cancelled'">❌ Cancelled</button>
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
              <h3 style="margin: 0 0 4px; font-size: 16px; color: #0F172A;">
                <span v-if="customerDisplayName">
                  <strong>{{ customerDisplayName }}</strong>
                  <span style="font-weight: 400; color: #64748B;"> · </span>
                </span>
                <span>Order #{{ (selected.id || 'UNKNOWN').toUpperCase() }}</span>
              </h3>
              <p style="margin: 0; font-size: 13px; color: #64748B;">
                {{ fmtDateTime(selected.createdAt) }} • {{ (selected.paymentMethod || 'N/A').toUpperCase() }} • {{ selected.paymentStatus || 'pending' }}
                <span v-if="customerDisplayPhone"> • 📞 {{ customerDisplayPhone }}</span>
              </p>
            </div>
            <button class="close-btn" @click="closeOrder">✕</button>
          </div>

          <div class="modal-body">
            <!-- Customer Info — full contact & address lookup so admin can arrange pickup -->
            <div class="info-card">
              <h4 style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #94A3B8;">
                Customer Info
                <button class="link-btn" @click="loadOrderUserProfile(selected)" :disabled="orderUserProfileLoading" style="float: right;">
                  ↻ Refresh
                </button>
              </h4>
              <!-- Big name so it's never missed -->
              <div style="font-size: 18px; color: #0F172A; font-weight: 700; margin-bottom: 12px;">
                {{ customerDisplayName || 'No name on record' }}
              </div>
              <div style="display: grid; gap: 6px; grid-template-columns: 1fr 1fr;">
                <div>
                  <span style="font-size: 11px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px;">Email</span>
                  <div style="font-size: 13px; color: #334155;">{{ orderUserProfile?.email || selected.customerEmail || 'N/A' }}</div>
                </div>
                <div>
                  <span style="font-size: 11px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px;">Phone</span>
                  <div style="font-size: 13px; color: #334155;">
                    <a v-if="customerDisplayPhone" :href="'tel:' + customerDisplayPhone" style="color: #2563EB; text-decoration: none;">
                      📞 {{ customerDisplayPhone }}
                    </a>
                    <span v-else>N/A</span>
                  </div>
                </div>
                <div style="grid-column: 1 / -1;">
                  <span style="font-size: 11px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px;">User ID (UID)</span>
                  <div style="font-size: 12px; color: #475569; font-family: monospace; word-break: break-all;">{{ selected.userId || 'N/A' }}</div>
                </div>
              </div>

              <!-- Address — fall back from order.address, then user profile defaultAddress, then list all addresses -->
              <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #E2E8F0;">
                <span style="font-size: 11px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px;">Shipping Address</span>
                <div style="margin-top: 4px;">
                  <p v-if="selected.address" style="margin: 0; font-size: 13px; color: #334155; white-space: pre-line;">
                    {{ selected.address }}
                    <span v-if="selected.pincode" style="font-weight: 600;"> — PIN {{ selected.pincode }}</span>
                  </p>
                  <div v-else-if="orderUserProfile?.defaultAddress" style="font-size: 13px; color: #334155;">
                    <div style="font-weight: 600;">{{ orderUserProfile.defaultAddress.fullName || orderUserProfile.name || 'N/A' }}</div>
                    <div>{{ orderUserProfile.defaultAddress.line1 || '' }} {{ orderUserProfile.defaultAddress.line2 || '' }}</div>
                    <div>{{ orderUserProfile.defaultAddress.city || '' }}, {{ orderUserProfile.defaultAddress.state || '' }} — <strong>{{ orderUserProfile.defaultAddress.pincode || 'N/A' }}</strong></div>
                    <div>📞 {{ orderUserProfile.defaultAddress.phone || orderUserProfile.phone || 'N/A' }}</div>
                  </div>
                  <p v-else style="margin: 0; font-size: 12px; color: #94A3B8;">No address on file for this order. (Older order — user must update address book.)</p>
                </div>

                <!-- If user has multiple addresses, list them -->
                <details v-if="(orderUserProfile?.addresses || []).length > 1" style="margin-top: 8px;">
                  <summary style="font-size: 11px; color: #2563EB; cursor: pointer;">📂 Other addresses on file ({{ orderUserProfile.addresses.length }})</summary>
                  <ul style="margin: 6px 0 0; padding-left: 20px; font-size: 12px; color: #475569;">
                    <li v-for="a in orderUserProfile.addresses" :key="a.id" style="margin-bottom: 6px;">
                      <strong v-if="a.isDefault">★ </strong>{{ a.line1 }} {{ a.line2 }} {{ a.city }} {{ a.state }} – {{ a.pincode }}
                      <span v-if="a.phone" style="color: #94A3B8;">({{ a.phone }})</span>
                    </li>
                  </ul>
                </details>
              </div>
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

            <!-- History Trail -->
            <div class="history-card">
              <div class="history-header">
                <h4 style="margin: 0; font-size: 12px; text-transform: uppercase; color: #94A3B8;">Order History</h4>
                <button class="history-refresh" @click="loadHistory(selected.id)" :disabled="orderHistoryLoading">↻ Refresh</button>
              </div>
              <div v-if="orderHistoryLoading && orderHistoryList.length === 0" class="history-empty">Loading…</div>
              <div v-else-if="orderHistoryList.length === 0" class="history-empty">
                No history yet. Future state changes will be recorded here. Older status changes made before history tracking was enabled will appear blank.
              </div>
              <ul v-else class="history-list">
                <li v-for="ev in orderHistoryList" :key="ev.id" class="history-row">
                  <span class="history-arrow">{{ formatHistoryArrow(ev.fromStatus, ev.toStatus) }}</span>
                  <div class="history-text">
                    <strong>{{ formatHistoryTitle(ev) }}</strong>
                    <span class="history-meta">
                      by {{ ev.actor?.email || ev.actor?.uid?.slice(0,6) + '…' || 'system' }}
                      ({{ ev.actor?.role || '?' }})
                      • {{ fmtDateTime(ev.ts) }}
                    </span>
                    <span v-if="ev.note" class="history-note">"{{ ev.note }}"</span>
                  </div>
                </li>
              </ul>
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

                <!-- Returned: pick reverse-pickup vs self-ship -->
                <div v-if="selected.shippingStatus === 'returned_refund_pending'" class="pickup-mode-card" style="background: #FEF2F2; border-color: #FCA5A5;">
                  <h5 style="margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: #B91C1C;">↩️ Returned-Item Pickup Mode</h5>
                  <p style="margin: 0 0 8px; font-size: 12px; color: #7F1D1D;">
                    We owe <strong>{{ money(selected.amount) }}</strong> in refund. Decide how the customer returns the item first.
                  </p>
                  <div class="btn-group">
                    <button class="btn-danger-outline w-100" @click="handlePickupChoice('pickup')" :disabled="pickupChoiceBusy">🚚 Reverse Pickup</button>
                    <button class="btn-outline w-100" @click="handlePickupChoice('selfship')" :disabled="pickupChoiceBusy">📮 Self-Ship (India Post)</button>
                  </div>
                  <div v-if="selected.pickupMode" style="margin-top: 10px; font-size: 12px; color: #065F46; background: #ECFDF5; padding: 8px; border-radius: 6px; border: 1px solid #6EE7B7;">
                    ✅ Set: <strong>{{ selected.pickupMode === 'pickup' ? 'Reverse Pickup' : 'Self-Ship' }}</strong>
                  </div>
                </div>
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

                <!-- Pickup mode chooser (admin decides how to receive original item back) -->
                <div class="pickup-mode-card">
                  <h5 style="margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: #94A3B8;">📦 Pickup Mode for Original Item</h5>
                  <p style="margin: 0 0 10px; font-size: 12px; color: #64748B;">
                    Customer: <strong>{{ orderUserProfile?.name || selected.customerName || 'N/A' }}</strong>
                    <template v-if="orderUserProfile?.phone || selected.phone"> • 📞 <strong>{{ orderUserProfile?.phone || selected.phone }}</strong></template>
                  </p>
                  <input v-model="pickupChoiceNote" placeholder="Optional note (e.g. 'Delhivery 2-3 day pickup')" class="clean-input" style="margin-bottom: 10px;" />
                  <div class="btn-group">
                    <button class="btn-primary w-100" @click="handlePickupChoice('pickup')" :disabled="pickupChoiceBusy">🚚 Schedule Reverse Pickup</button>
                    <button class="btn-outline w-100" @click="handlePickupChoice('selfship')" :disabled="pickupChoiceBusy">📮 Tell user to self-ship (India Post)</button>
                  </div>
                  <div v-if="selected.pickupMode" style="margin-top: 10px; padding: 10px; border-radius: 6px; background: #ECFDF5; border: 1px solid #6EE7B7; font-size: 12px; color: #065F46;">
                    ✅ Set: <strong>{{ selected.pickupMode === 'pickup' ? 'Reverse Pickup Scheduled' : 'Self-Ship via India Post' }}</strong>
                    <span v-if="selected.pickupNote"> — {{ selected.pickupNote }}</span>
                    <button class="link-btn" @click="clearPickupChoice" :disabled="pickupChoiceBusy" style="margin-left: 8px;">Clear</button>
                  </div>
                </div>
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

/* Quick-count tiles above the table */
.stats-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; padding: 12px 24px; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; }
.stat-tile { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid #E2E8F0; border-radius: 10px; background: #F8FAFC; transition: 0.18s; }
.stat-tile:hover { border-color: #0F172A; background: #FFFFFF; }
.stat-tile.active { background: #0F172A; border-color: #0F172A; color: #FFFFFF; }
.stat-tile.muted { background: transparent; }
.stat-num { font-size: 24px; font-weight: 800; line-height: 1; color: inherit; }
.stat-tile.active .stat-num { color: #FFFFFF; }
.stat-text { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; font-weight: 600; }
.stat-tile.active .stat-text { color: #CBD5E1; }
.table-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; }

/* TOOLBAR */
.toolbar { padding: 16px 24px; border-bottom: 1px solid #E2E8F0; display: flex; flex-direction: column; gap: 16px; }
.search-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.search-box { position: relative; display: flex; align-items: center; width: 100%; max-width: 400px; }
.search-icon { position: absolute; left: 12px; font-size: 12px; color: #94A3B8; }
.search-box input { width: 100%; padding: 10px 32px 10px 32px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; outline: none; color: #334155; font-family: inherit; }
.search-box input:focus { border-color: #0F172A; }
.clear-search { position: absolute; right: 8px; background: transparent; border: none; color: #94A3B8; cursor: pointer; font-size: 13px; padding: 4px 8px; }
.clear-search:hover { color: #EF4444; }

.btn-lookup { background: #FFFFFF; color: #0F172A; border: 1px solid #0F172A; padding: 9px 14px; border-radius: 8px; font-weight: 600; cursor: pointer; font-family: inherit; font-size: 13px; transition: 0.18s; }
.btn-lookup:hover:not(:disabled) { background: #0F172A; color: #FFFFFF; }
.btn-lookup:disabled { color: #94A3B8; border-color: #CBD5E1; cursor: not-allowed; }

.lookup-note { padding: 8px 24px; background: #EFF6FF; color: #1E40AF; font-size: 12px; border-bottom: 1px solid #BFDBFE; }

.priority-pill { background: #FFF7ED; border-color: #FDBA74; color: #C2410C; }
.priority-pill:hover { border-color: #C2410C; color: #C2410C; background: #FFEDD5; }
.priority-pill.active { background: #C2410C; color: #FFFFFF; border-color: #C2410C; }

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

/* Pickup mode chooser */
.pickup-mode-card { background: #F8FAFC; border: 1px solid #CBD5E1; padding: 14px; border-radius: 8px; margin-top: 12px; }
.link-btn { background: transparent; border: none; color: #2563EB; font-size: 11px; cursor: pointer; padding: 0; font-family: inherit; text-decoration: underline; }
.link-btn:hover { color: #1D4ED8; }
.link-btn:disabled { color: #94A3B8; cursor: not-allowed; }
.m-item { display: flex; gap: 12px; align-items: center; padding-bottom: 12px; border-bottom: 1px dashed #E2E8F0; margin-bottom: 12px; }
.m-item:last-child { border: none; padding-bottom: 0; margin-bottom: 0; }
.m-item-img { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; border: 1px solid #E2E8F0; }
.m-item-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.item-name { font-size: 13px; color: #0F172A; font-weight: 500; }
.item-price { font-size: 13px; color: #475569; }

.action-zone { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; }

.history-card { background: #ffffff; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 16px; }
.history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.history-refresh { background: white; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; color: #334155; }
.history-empty { color: #94a3b8; font-size: 12px; padding: 8px 0; }
.history-list { list-style: none; padding: 0; margin: 0; max-height: 240px; overflow-y: auto; }
.history-row { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px dashed #e2e8f0; }
.history-row:last-child { border-bottom: none; }
.history-arrow { font-family: monospace; font-weight: 600; color: #1e40af; background: #eff6ff; padding: 2px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
.history-text { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: #0f172a; }
.history-meta { font-size: 11px; color: #64748b; }
.history-note { font-size: 12px; color: #475569; font-style: italic; margin-top: 2px; }
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