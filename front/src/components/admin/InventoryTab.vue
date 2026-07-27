<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetchAllProducts, updateProduct, subscribeToProducts } from '../db.js'

const router = useRouter()
const props = defineProps({ userRole: { type: String, default: 'user' } })

const searchText = ref('')
const products = ref([])
const loading = ref(true)
const activeTab = ref('all') // 'all' | 'low-stock' | 'out-of-stock'
const LOW_STOCK_THRESHOLD = 10
const expandedProducts = ref(new Set())
const modalOpen = ref(false)
const modalProduct = ref(null)
const modalVariant = ref(null)
const modalStock = ref('')
const modalError = ref('')

const canCreateProduct = computed(() => props.userRole === 'admin' || props.userRole === 'superadmin')
const goCreateProduct = () => {
  if (!canCreateProduct.value) {
    alert('❌ ACCESS DENIED: Only Admins can create products.')
    return
  }
  router.push('/admin/product/new')
}

// Flatten products into variant rows for display
const variantRows = computed(() => {
  const rows = []
  for (const product of products.value) {
    const variants = product.variants || []
    // If no variants but has legacy price/stock, create a default variant row
    if (variants.length === 0 && (product.price !== undefined || product.stock !== undefined)) {
      rows.push({
        productId: product.id,
        productName: product.name,
        productImage: product.imageUrls?.[0] || null,
        variantLabel: 'Standard',
        variantId: 'standard',
        variantType: 'Standard',
        price: Number(product.price) || 0,
        stock: Number(product.stock) || 0,
        active: product.isActive !== false,
        variantActive: true,
        isLegacy: true
      })
    } else {
      for (const variant of variants) {
        rows.push({
          productId: product.id,
          productName: product.name,
          productImage: product.imageUrls?.[0] || null,
          variantLabel: variant.label,
          variantId: variant.variantId || variant.label?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'unknown',
          variantType: variant.type || 'Size',
          price: Number(variant.price) || 0,
          stock: Number(variant.stock) || 0,
          active: product.isActive !== false,
          variantActive: variant.active !== false,
          isLegacy: false
        })
      }
    }
  }
  return rows
})

const productRows = computed(() => {
  return products.value.map(product => {
    const variants = product.variants || []
    const rows = variants.length === 0 && (product.price !== undefined || product.stock !== undefined)
      ? [{
          label: 'Standard',
          variantId: product.id,
          variantType: 'Standard',
          price: Number(product.price) || 0,
          stock: Number(product.stock) || 0,
          active: true,
          isLegacy: true,
        }]
      : variants.map(variant => ({
          label: variant.label,
          variantId: variant.variantId || variant.label?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'unknown',
          variantType: variant.type || 'Size',
          price: Number(variant.price) || 0,
          stock: Number(variant.stock) || 0,
          active: variant.active !== false,
          isLegacy: false,
        }))

    const totalStock = rows.reduce((sum, item) => sum + item.stock, 0)
    const minPrice = rows.length ? Math.min(...rows.map(item => item.price)) : 0
    const maxPrice = rows.length ? Math.max(...rows.map(item => item.price)) : 0
    const allInactive = rows.every(item => !item.active)
    const anyLowStock = rows.some(item => item.stock > 0 && item.stock <= LOW_STOCK_THRESHOLD)

    return {
      product,
      productId: product.id,
      productName: product.name,
      productImage: product.imageUrls?.[0] || null,
      variantCount: rows.length,
      totalStock,
      priceRange: rows.length ? (minPrice === maxPrice ? formatPrice(minPrice) : `${formatPrice(minPrice)} - ${formatPrice(maxPrice)}`) : '₹0',
      variants: rows,
      isActive: product.isActive !== false,
      statusClass: !product.isActive ? 'status-inactive' : totalStock === 0 ? 'stock-out' : anyLowStock ? 'stock-low' : 'stock-ok',
      statusLabel: !product.isActive
        ? 'Product Hidden'
        : totalStock === 0
          ? 'Out of Stock'
          : anyLowStock
            ? `Low Stock (${totalStock})`
            : `In Stock (${totalStock})`,
      anyVariantInactive: !allInactive && rows.some(item => !item.active),
    }
  })
})

const filteredRows = computed(() => {
  let rows = productRows.value

  if (activeTab.value === 'low-stock') {
    rows = rows.filter(r => r.variants.some(v => v.stock > 0 && v.stock <= LOW_STOCK_THRESHOLD))
  } else if (activeTab.value === 'out-of-stock') {
    rows = rows.filter(r => r.variants.every(v => v.stock === 0))
  }

  if (searchText.value.trim()) {
    const q = searchText.value.toLowerCase().trim()
    rows = rows.filter(r =>
      r.productName.toLowerCase().includes(q) ||
      r.productId.toLowerCase().includes(q) ||
      r.variants.some(v => v.label.toLowerCase().includes(q) || v.variantId.toLowerCase().includes(q))
    )
  }

  return rows
})

const lowStockCount = computed(() =>
  variantRows.value.filter(r => r.stock > 0 && r.stock <= LOW_STOCK_THRESHOLD).length
)

const outOfStockCount = computed(() =>
  variantRows.value.filter(r => r.stock === 0).length
)

const totalVariants = computed(() => variantRows.value.length)

let _unsubProducts = null

const subscribeToProductsLive = async () => {
  try {
    const allProducts = await fetchAllProducts()
    products.value = allProducts
  } catch (e) {
    console.error('Failed to load products:', e)
  } finally {
    loading.value = false
  }
  _unsubProducts = subscribeToProducts((snapshot) => {
    products.value = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
  })
}

onMounted(() => {
  subscribeToProductsLive()
})

onUnmounted(() => {
  if (typeof _unsubProducts === 'function') _unsubProducts()
  _unsubProducts = null
})

const getStockStatus = (stock) => {
  if (stock === 0) return { label: 'Out of Stock', class: 'stock-out' }
  if (stock <= LOW_STOCK_THRESHOLD) return { label: `Low Stock (${stock})`, class: 'stock-low' }
  return { label: `In Stock (${stock})`, class: 'stock-ok' }
}

const getStatusClass = (row) => {
  if (!row.isActive) return 'status-inactive'
  if (row.anyVariantInactive) return 'status-inactive'
  return row.statusClass
}

const toggleExpanded = (productId) => {
  if (expandedProducts.value.has(productId)) {
    expandedProducts.value.delete(productId)
  } else {
    expandedProducts.value.add(productId)
  }
}

const toggleVariantActive = async (productId, variantId, currentlyActive) => {
  if (props.userRole !== 'superadmin') {
    alert('❌ ACCESS DENIED: Only SuperAdmins can change variant status.')
    return
  }

  const product = products.value.find(p => p.id === productId)
  if (!product) return

  if (!product.variants?.length) {
    alert('No variants available to update for this product.')
    return
  }

  const variants = [...product.variants]
  const variantIndex = variants.findIndex(v =>
    (v.variantId || v.label?.toLowerCase().replace(/[^a-z0-9]+/g, '-')) === variantId
  )
  if (variantIndex === -1) return

  variants[variantIndex].active = !currentlyActive

  try {
    await updateProduct(productId, { variants })
    alert('Variant status updated successfully')
  } catch (e) {
    alert('Error updating variant: ' + e.message)
  }
}

const editVariantStock = (productId, variantId, variantLabel, currentStock) => {
  if (props.userRole !== 'superadmin') {
    alert('❌ ACCESS DENIED: Only SuperAdmins can edit stock.')
    return
  }

  const product = products.value.find(p => p.id === productId)
  if (!product) return

  modalProduct.value = product
  modalVariant.value = {
    id: variantId,
    label: variantLabel,
  }
  modalStock.value = currentStock
  modalError.value = ''
  modalOpen.value = true
}

const closeStockModal = () => {
  modalOpen.value = false
  modalProduct.value = null
  modalVariant.value = null
  modalStock.value = ''
  modalError.value = ''
}

const saveStockModal = async () => {
  const stockNum = Number(modalStock.value)
  if (isNaN(stockNum) || stockNum < 0) {
    modalError.value = 'Please enter a valid non-negative number'
    return
  }

  const product = modalProduct.value
  const variantId = modalVariant.value?.id

  if (!product) {
    modalError.value = 'Unable to find the selected product.'
    return
  }

  try {
    if (!product.variants?.length) {
      await updateProduct(product.id, { stock: stockNum })
    } else {
      const variants = [...product.variants]
      const variantIndex = variants.findIndex(v =>
        (v.variantId || v.label?.toLowerCase().replace(/[^a-z0-9]+/g, '-')) === variantId
      )
      if (variantIndex === -1) {
        modalError.value = 'Variant not found.'
        return
      }
      variants[variantIndex] = {
        ...variants[variantIndex],
        stock: stockNum,
      }
      await updateProduct(product.id, { variants })
    }

    closeStockModal()
    alert('Stock updated successfully')
  } catch (e) {
    modalError.value = 'Error updating stock: ' + e.message
  }
}

const goEditProduct = (productId) => {
  window.location.href = `/admin/product/${productId}`
}

const formatPrice = (price) => `₹${Number(price).toLocaleString('en-IN')}`

const generateSlug = (name) => name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') : 'product'
const goToProduct = (productId, productName) => router.push(`/product/${generateSlug(productName)}--${productId}`)
</script>

<template>
  <div class="fade-in">
    <div class="ws-head">
      <div>
        <h2 class="ws-title">Product Inventory</h2>
        <p class="ws-subtitle">View products as single rows and edit each variant from one place.</p>
      </div>
      <div class="ws-actions">
        <input v-model="searchText" class="search-input" placeholder="Search product, variant, or ID…" />
        <button
          v-if="canCreateProduct"
          class="btn-new-product"
          @click="goCreateProduct"
          title="Create a new product"
        >
          <span style="font-size: 16px; line-height: 1;">＋</span>
          <span>New Product</span>
        </button>
      </div>
    </div>

    <!-- Summary Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-value">{{ totalVariants }}</span>
        <span class="stat-label">Total Variants</span>
      </div>
      <div class="stat-card warning">
        <span class="stat-value">{{ lowStockCount }}</span>
        <span class="stat-label">Low Stock (≤{{ LOW_STOCK_THRESHOLD }})</span>
      </div>
      <div class="stat-card danger">
        <span class="stat-value">{{ outOfStockCount }}</span>
        <span class="stat-label">Out of Stock</span>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="inventory-tabs">
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'all' }" 
        @click="activeTab = 'all'"
      >
        All Variants ({{ variantRows.length }})
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'low-stock' }" 
        @click="activeTab = 'low-stock'"
      >
        ⚠️ Low Stock ({{ lowStockCount }})
      </button>
      <button 
        class="tab-btn" 
        :class="{ active: activeTab === 'out-of-stock' }" 
        @click="activeTab = 'out-of-stock'"
      >
        🚫 Out of Stock ({{ outOfStockCount }})
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading inventory...</p>
    </div>

    <!-- Inventory Table -->
    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Variants</th>
            <th>Price</th>
            <th>Total Stock</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in filteredRows" :key="row.productId">
            <tr :class="getStatusClass(row)" @click="goToProduct(row.productId, row.productName)" style="cursor: pointer;">
              <td>
                <div class="item-meta">
                  <div class="thumb-cell">
                    <img v-if="row.productImage" :src="row.productImage" class="thumb-img" />
                  </div>
                  <div>
                    <div class="item-name">{{ row.productName }}</div>
                    <code class="item-sub">ID: {{ row.productId.substring(0, 8) }}</code>
                  </div>
                </div>
              </td>
              <td>{{ row.variantCount }} item<span v-if="row.variantCount !== 1">s</span></td>
              <td class="price-cell">{{ row.priceRange }}</td>
              <td>{{ row.totalStock }}</td>
              <td>
                <span class="status-pill" :class="getStatusClass(row)">
                  {{ row.statusLabel }}
                </span>
              </td>
              <td>
                <div class="row-actions">
                  <button class="btn-outline" @click.stop="toggleExpanded(row.productId)">
                    {{ expandedProducts.has(row.productId) ? 'Hide variants' : 'View variants' }}
                  </button>
                  <button class="btn-edit" @click.stop="goEditProduct(row.productId)">Edit Product</button>
                </div>
              </td>
            </tr>
            <tr v-if="expandedProducts.has(row.productId)" class="variant-detail-row">
              <td colspan="6">
                <div class="variant-grid">
                  <div class="variant-row" v-for="variant in row.variants" :key="variant.variantId" :class="{ 'variant-inactive': !variant.active }">
                    <div class="variant-cell">
                      <strong>{{ variant.label }}</strong>
                      <span class="text-sub">{{ variant.variantType }}</span>
                    </div>
                    <div>{{ formatPrice(variant.price) }}</div>
                    <div>{{ variant.stock }}</div>
                    <div>
                      <span class="status-pill" :class="getStockStatus(variant.stock).class">
                        {{ getStockStatus(variant.stock).label }}
                      </span>
                    </div>
                    <div class="variant-actions">
                      <button class="btn-outline small" @click="toggleVariantActive(row.productId, variant.variantId, variant.active)">
                        {{ variant.active ? 'Deactivate' : 'Activate' }}
                      </button>
                      <button class="btn-edit small" @click="editVariantStock(row.productId, variant.variantId, variant.label, variant.stock)">
                        Edit Stock
                      </button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="filteredRows.length === 0">
            <td colspan="6" class="empty-state">
              <div v-if="activeTab !== 'all'">No products match this filter</div>
              <div v-else>No products available</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="modalOpen" class="modal-overlay" @click.self="closeStockModal">
        <div class="modal-card">
          <div class="modal-header">
            <div>
              <h3 class="modal-title">Edit Stock</h3>
              <p class="modal-subtitle">
                {{ modalProduct?.name }} — {{ modalVariant?.label }}
              </p>
            </div>
            <button class="close-btn" @click="closeStockModal">✕</button>
          </div>
          <div class="modal-body">
            <label class="modal-field">
              <span>Stock quantity</span>
              <input
                type="number"
                min="0"
                v-model.number="modalStock"
                class="modal-input"
              />
            </label>
            <p v-if="modalError" class="modal-error">{{ modalError }}</p>
          </div>
          <div class="modal-actions">
            <button class="btn-outline" @click="closeStockModal">Cancel</button>
            <button class="btn-primary" @click="saveStockModal">Save stock</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-in { animation: fIn 0.3s ease-out; }
@keyframes fIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.ws-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
.ws-title { font-size: 1.6rem; font-weight: 800; color: #0F172A; margin: 0 0 4px; }
.ws-subtitle { font-size: 0.85rem; color: #64748B; margin: 0; }
.ws-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.search-input { padding: 10px 14px; border: 1px solid #CBD5E1; border-radius: 8px; outline: none; font-family: inherit; font-size: 0.9rem; min-width: 280px; }
.search-input:focus { border-color: #0F2A1F; }

/* Stats Grid */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
.stat-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
.stat-card.warning { border-left: 4px solid #F59E0B; }
.stat-card.danger { border-left: 4px solid #EF4444; }
.stat-value { font-size: 2rem; font-weight: 800; color: #0F172A; line-height: 1; }
.stat-label { font-size: 0.8rem; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }

/* Tabs */
.inventory-tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
.tab-btn { padding: 10px 18px; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.85rem; font-weight: 600; color: #334155; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.tab-btn:hover { border-color: #0F2A1F; color: #0F2A1F; }
.tab-btn.active { background: #0F2A1F; border-color: #0F2A1F; color: #FFFFFF; }

/* Loading */
.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: #64748B; gap: 16px; }
.spinner { width: 36px; height: 36px; border: 3px solid #E2E8F0; border-top-color: #0F2A1F; border-radius: 50%; animation: rot .8s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }

/* Table */
.table-wrap { background: #FFFFFF; border-radius: 12px; border: 1px solid #E2E8F0; overflow-x: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.02); }
.data-table { width: 100%; border-collapse: collapse; text-align: left; min-width: 1000px; }
.data-table th { background: #F8FAFC; padding: 16px; font-size: 0.8rem; font-weight: 800; text-transform: uppercase; color: #475569; border-bottom: 2px solid #E2E8F0; white-space: nowrap; }
.data-table td { padding: 16px; border-bottom: 1px solid #E2E8F0; color: #0F172A; vertical-align: middle; }

.item-meta { display: flex; align-items: center; gap: 12px; }
.thumb-cell { width: 44px; height: 44px; border-radius: 8px; background: #F1F5F9; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid #E2E8F0; }
.thumb-img { width: 100%; height: 100%; object-fit: cover; }
.item-name { font-weight: 800; font-size: 0.95rem; }
.item-sub { font-size: 0.75rem; color: #64748B; margin-top: 2px; background: #E2E8F0; padding: 2px 6px; border-radius: 4px; }

.variant-info { display: flex; flex-direction: column; gap: 4px; }
.variant-type-badge { font-size: 0.7rem; font-weight: 700; color: #64748B; text-transform: uppercase; }
.variant-label { font-weight: 700; font-size: 0.95rem; color: #0F172A; }

.variant-id { font-size: 0.75rem; color: #64748B; background: #F1F5F9; padding: 2px 8px; border-radius: 4px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 16px; }
.modal-card { width: min(480px, 100%); background: #fff; border-radius: 18px; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18); overflow: hidden; }
.modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 24px 24px 16px; border-bottom: 1px solid #E2E8F0; }
.modal-title { margin: 0; font-size: 1.1rem; font-weight: 800; color: #0F172A; }
.modal-subtitle { margin: 6px 0 0; font-size: 0.9rem; color: #64748B; }
.close-btn { width: 34px; height: 34px; border: none; background: #F1F5F9; border-radius: 12px; color: #475569; cursor: pointer; }
.modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
.modal-field { display: grid; gap: 8px; }
.modal-field span { font-size: 0.85rem; color: #475569; font-weight: 700; }
.modal-input { width: 100%; border: 1px solid #CBD5E1; border-radius: 10px; padding: 12px 14px; font: inherit; font-size: 1rem; color: #0F172A; }
.modal-input:focus { outline: none; border-color: #0F2A1F; }
.modal-error { margin: 0; color: #DC2626; font-size: 0.9rem; }
.modal-actions { display: flex; justify-content: flex-end; gap: 12px; padding: 18px 24px 24px; border-top: 1px solid #E2E8F0; }
.modal-actions .btn-outline, .modal-actions .btn-primary { min-width: 108px; }

.variant-detail-row td { background: #f8fafc; padding: 12px 18px; }
.variant-grid { display: grid; gap: 12px; }
.variant-row { display: grid; grid-template-columns: minmax(220px, 1.3fr) minmax(110px, 1fr) minmax(90px, 0.85fr) minmax(130px, 1fr) minmax(210px, 1.2fr); gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
.variant-row:last-child { border-bottom: none; }
.variant-cell { display: flex; flex-direction: column; gap: 4px; }
.variant-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.btn-outline.small, .btn-edit.small { padding: 6px 10px; font-size: 12px; }
.variant-inactive { opacity: 0.7; }

.price-cell { font-weight: 700; font-size: 1rem; color: #0F172A; }

.stock-cell { display: flex; flex-direction: column; gap: 4px; }
.stock-value { font-size: 1.1rem; font-weight: 800; color: #0F172A; }
.stock-value.stock-zero { color: #DC2626; }
.stock-value.stock-low { color: #F59E0B; }
.stock-status { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
.stock-status.stock-out { color: #DC2626; }
.stock-status.stock-low { color: #F59E0B; }
.stock-status.stock-ok { color: #16A34A; }

.status-pill { padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; display: inline-block; }
.status-pill.status-inactive { background: #F1F5F9; color: #64748B; border: 1px solid #E2E8F0; }
.status-pill.stock-out { background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; }
.status-pill.stock-low { background: #FFFBEB; color: #F59E0B; border: 1px solid #FDE68A; }
.status-pill.stock-ok { background: #F0FDF4; color: #16A34A; border: 1px solid #BBF7D0; }

.row-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn-outline { background: #FFFFFF; color: #0F172A; border: 1px solid #CBD5E1; padding: 6px 12px; border-radius: 6px; font-weight: 700; cursor: pointer; white-space: nowrap; font-size: 0.8rem; transition: all 0.2s; }
.btn-outline:hover { border-color: #0F2A1F; background: #F8FAFC; }

/* New-Product CTA — sits in the inventory toolbar */
.btn-new-product { display: inline-flex; align-items: center; gap: 8px; background: #0F2A1F; color: #FFFFFF; border: 1px solid #0F2A1F; padding: 10px 18px; border-radius: 10px; font-weight: 700; cursor: pointer; font-family: inherit; font-size: 0.9rem; transition: all 0.18s; box-shadow: 0 2px 6px rgba(15, 42, 31, 0.18); }
.btn-new-product:hover { background: #0B1F18; border-color: #0B1F18; transform: translateY(-1px); }
.btn-edit { background: #F1F5F9; color: #0F172A; border: 1px solid #CBD5E1; padding: 6px 12px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 0.8rem; }
.btn-edit:hover { background: #E2E8F0; }

/* Row highlighting */
tr.status-inactive { background: #F8FAFC; }
tr.status-inactive:hover { background: #F1F5F9; }
tr.stock-out:hover { background: #FEF2F2; }
tr.stock-low:hover { background: #FFFBEB; }

.empty-state { text-align: center; padding: 40px 20px; color: #64748B; font-size: 0.95rem; }

@media (max-width: 768px) {
  .ws-head { flex-direction: column; align-items: stretch; }
  .search-input { width: 100%; }
  .stats-grid { grid-template-columns: 1fr; }
  .inventory-tabs { overflow-x: auto; }
  .tab-btn { flex-shrink: 0; }
}
</style>