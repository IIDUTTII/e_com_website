<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auth } from '../firebase.js'
import { uploadProductImage, fetchAllProductImages, deleteProductImage, fetchProductById, addProduct, updateProduct, fetchProductCategories, getStorageFileSizeLabel } from './db.js'

defineOptions({ name: 'ProductForm' })
const route = useRoute(), router = useRouter()

const isEditing = ref(false), rawId = ref(null), activeTab = ref('basic'), saving = ref(false), initializing = ref(true)
const isUploadingImages = ref(false), uploadStatusText = ref('')
const existingCategories = ref(['Spices & Herbs', 'Ghee & Oils', 'Organic Sweets', 'Himalayan Teas', 'Juices'])

const getDefaultForm = () => ({
  name: '', shortDesc: '', description: '', category: 'Spices & Herbs', priorityOrder: 99,
  // Newly created products are ACTIVE by default — the admin can hide
  // them from the form's "Visible to customers" switch if they're
  // drafting. Without this default every new product lands hidden and
  // is unreachable from the storefront unless the admin flips it.
  isActive: true, discount: { isDiscounted: false, percent: 0 },
  reviewCount: 0, ratingAverage: 0.0, createdBy: 'ADMIN_USER',
  imageUrls: [], benefits: [''], ingredients: [''], origin: '', howToUse: '', shelfLife: '', tags: [''],
  variants: []
})

const form = ref(getDefaultForm())
const storageImages = ref([]) 
const newExternalUrl = ref('')
const newVariant = ref({ 
  type: 'Size', 
  label: '', 
  price: null, 
  stock: 0, 
  active: true, 
  variantId: '' 
})

const previewBasePrice = computed(() => form.value.variants.length > 0 ? Number(form.value.variants[0].price) : 0)
const calculatedFinalPrice = computed(() => {
  if (!form.value.discount?.isDiscounted) return previewBasePrice.value
  const percentNode = Number(form.value.discount.percent) || 0
  return Math.round(previewBasePrice.value * (1 - percentNode / 100))
})
const calculatedSavingsAmount = computed(() => Math.max(previewBasePrice.value - calculatedFinalPrice.value, 0))

const formatBytes = (bytes) => {
    if(bytes === 0) return '0 Bytes';
    const k = 1024, dm = 2, sizes = ['Bytes', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

onMounted(() => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return router.push('/login')
    const productId = route.params.id

    try {
        const cats = await fetchProductCategories()
        if(cats.length > 0) existingCategories.value = cats
    } catch(e) {}

    if (productId && productId !== 'new') {
      isEditing.value = true; rawId.value = productId
      try {
        const p = await fetchProductById(productId)
        if (p) {
          // Merge data, but ensure variants exist
          let variants = p.variants || []
          // If product has price/stock but no variants, auto-create a default variant
          if (variants.length === 0 && (p.price !== undefined || p.stock !== undefined)) {
            variants = [{
              type: 'Standard',
              label: 'Standard',
              price: Number(p.price) || 0,
              stock: Number(p.stock) || 0,
              active: true,
              variantId: 'standard'
            }]
          }
          form.value = {
            ...getDefaultForm(), 
            ...p, 
            discount: p.discount || { isDiscounted: false, percent: 0 },
            imageUrls: p.imageUrls || [], 
            benefits: p.benefits?.length ? [...p.benefits] : [''],
            ingredients: p.ingredients?.length ? [...p.ingredients] : [''],
            variants: variants
          }
        }
        const urls = await fetchAllProductImages(productId)
        for (const url of urls) {
           let realSize = 'Unknown Size'
           try { realSize = await getStorageFileSizeLabel(url) } catch(e){}
           storageImages.value.push({ url, note: `Size: ${realSize}` })
        }
      } catch (e) { console.error("Fetch Error: ", e) }
    }
    initializing.value = false
  })
})

const addArrayItem = (field) => { if (!form.value[field]) form.value[field] = []; form.value[field].push('') }
const removeArrayItem = (field, idx) => { if (form.value[field]) form.value[field].splice(idx, 1) }

const addVariant = () => {
    if(!newVariant.value.label || !newVariant.value.price) return;
    // Auto‑generate variantId if not provided
    if (!newVariant.value.variantId) {
      newVariant.value.variantId = newVariant.value.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    }
    form.value.variants.push({...newVariant.value})
    newVariant.value = { type: 'Size', label: '', price: null, stock: 0, active: true, variantId: '' }
}
const removeVariant = (idx) => { form.value.variants.splice(idx, 1) }

// Per-variant inline editing (price + stock; id and label are immutable)
const editingVariantIdx = ref(null)
const startEditVariant = (idx) => { editingVariantIdx.value = idx }
const cancelEditVariant = () => { editingVariantIdx.value = null }
const saveVariantEdits = () => {
  // Normalize types right before saving the form
  for (const v of form.value.variants) {
    if (v.price !== '' && v.price !== null && v.price !== undefined) v.price = Number(v.price)
    if (v.stock !== '' && v.stock !== null && v.stock !== undefined) v.stock = Number(v.stock)
  }
  editingVariantIdx.value = null
}

const handleLocalImageUpload = async (event) => {
  if (!isEditing.value) { alert("Please save Basic Info first before uploading media."); return; }
  const files = event.target.files
  if (!files || files.length === 0) return
  isUploadingImages.value = true

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file.type.startsWith('image/')) continue
    try {
      uploadStatusText.value = `Processing ${i + 1} of ${files.length}...`
      const url = await uploadProductImage(file, rawId.value) 
      form.value.imageUrls.push(url)
      const realSize = await getStorageFileSizeLabel(url)
      storageImages.value.push({ url, note: `Size: ${realSize}` })
    } catch (error) { alert(`Upload failed: ${error.message}`) }
  }
  isUploadingImages.value = false; uploadStatusText.value = ''; event.target.value = ''
}

const removeStorageImage = async (url) => {
  if (!confirm("Permanently delete this image from storage?")) return
  try {
    isUploadingImages.value = true
    await deleteProductImage(url)
    form.value.imageUrls = form.value.imageUrls.filter(u => u !== url)
    storageImages.value = storageImages.value.filter(u => (u.url ? u.url !== url : u !== url))
  } catch(e) { alert("Error deleting: " + e.message) } finally { isUploadingImages.value = false }
}

const toggleSelection = (url) => {
  const idx = form.value.imageUrls.indexOf(url)
  if (idx > -1) form.value.imageUrls.splice(idx, 1)
  else form.value.imageUrls.push(url)
}
const isVisibleToUser = (url) => form.value.imageUrls.includes(url)
const makePrimary = (url) => {
  const arr = form.value.imageUrls; const idx = arr.indexOf(url)
  if (idx > 0) { arr.splice(idx, 1); arr.unshift(url) }
  else if (idx === -1) { arr.unshift(url) }
}
const getRawUrl = (img) => typeof img === 'object' ? img.url : img;
const getImgNote = (img) => typeof img === 'object' ? img.note : null;

const handleSubmit = async () => {
  if (form.value.variants.length === 0) {
    alert("You must add at least one variant to define the price and stock.");
    activeTab.value = 'basic';
    return;
  }

  // Final normalization: every variant has a numeric price and stock
  const errors = [];
  const normalizedVariants = form.value.variants.map(v => {
    const price = Number(v.price);
    const stock = Number(v.stock);
    if (!Number.isFinite(price) || price < 0) errors.push(`${v.label || v.variantId || 'Variant'}: invalid price`);
    if (!Number.isInteger(stock) || stock < 0) errors.push(`${v.label || v.variantId || 'Variant'}: invalid stock`);
    return {
      ...v,
      price: Number.isFinite(price) ? price : 0,
      stock: Number.isInteger(stock) ? stock : 0,
      active: v.active !== false,
      variantId: v.variantId || v.label?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '',
    };
  });
  if (errors.length) { alert('Please fix variants:\n• ' + errors.join('\n• ')); return; }

  saving.value = true
  const clean = (arr) => (arr || []).filter(v => v?.trim())

  const payload = {
    name: form.value.name, shortDesc: form.value.shortDesc, description: form.value.description,
    category: form.value.category, priorityOrder: Number(form.value.priorityOrder),
    isActive: form.value.isActive,
    discount: { isDiscounted: form.value.discount.isDiscounted, percent: Number(form.value.discount.percent) },
    reviewCount: Number(form.value.reviewCount), ratingAverage: Number(form.value.ratingAverage),
    createdBy: form.value.createdBy, imageUrls: clean(form.value.imageUrls),
    benefits: clean(form.value.benefits), ingredients: clean(form.value.ingredients),
    tags: clean(form.value.tags), origin: form.value.origin, howToUse: form.value.howToUse, shelfLife: form.value.shelfLife,
    variants: normalizedVariants, updatedAt: new Date()
  }
  
  try {
    if (isEditing.value) { await updateProduct(rawId.value, payload) }
    else { await addProduct(payload) }
    editingVariantIdx.value = null
    router.push('/admin')
  } catch (e) { alert('Error saving: ' + e.message) }
  finally { saving.value = false }
}
</script>

<template>
  <div class="form-workspace-page">
    <div v-if="initializing" class="loading-state"><div class="spinner"></div><p>Loading Product Data...</p></div>

    <div v-else class="form-container fade-in">
      <header class="form-header">
        <div>
          <button type="button" class="back-link-btn" @click="router.push('/admin')">← Back to Dashboard</button>
          <h2>{{ isEditing ? 'Edit Product' : 'Add New Product' }}</h2>
        </div>
        <div class="tabs-row">
          <button type="button" :class="['tab-btn', { active: activeTab === 'basic' }]" @click.prevent="activeTab = 'basic'">Basic Info</button>
          <button type="button" :class="['tab-btn', { active: activeTab === 'detail' }]" @click.prevent="activeTab = 'detail'">Descriptions</button>
          <button type="button" :class="['tab-btn', { active: activeTab === 'media' }]" @click.prevent="activeTab = 'media'" :disabled="!isEditing">Media</button>
        </div>
      </header>

      <form @submit.prevent="handleSubmit" class="core-product-form">
        <div v-show="activeTab === 'basic'" class="grid-layout">
          <div class="input-group full-width"><label>Product Title Name *</label><input v-model="form.name" required /></div>
          <div class="input-group full-width"><label>Short Description (Subtitle) *</label><input v-model="form.shortDesc" required maxlength="60" /></div>

          <div class="input-group"><label>Category *</label>
             <input v-model="form.category" list="catList" required />
             <datalist id="catList"><option v-for="c in existingCategories" :key="c" :value="c"></option></datalist>
          </div>
          
          <div class="input-group"><label>Display Priority (1=Top)</label><input v-model="form.priorityOrder" type="number" /></div>
          <div class="input-group"><label>Shelf Life</label><input v-model="form.shelfLife" placeholder="e.g., 12 Months" /></div>

          <div class="input-group full-width visibility-toggle"
               :class="form.isActive ? 'is-visible' : 'is-hidden'">
            <label class="visibility-label">
              <input type="checkbox" v-model="form.isActive" />
              <span class="visibility-label-text">
                <strong>{{ form.isActive ? '👁️ Visible to customers' : '🚫 Hidden from customers' }}</strong>
                <small>{{ form.isActive
                  ? 'Product is live on the storefront and can be ordered.'
                  : 'Product is hidden from /products and from any direct URL. Customers will see "Currently unavailable" if they navigate to it.' }}</small>
              </span>
            </label>
          </div>

          <div class="divider full-width">Variants & Pricing (Each variant has its own stock)</div>
          <div class="full-width variants-builder-box">
             <div class="variants-row input-row">
                 <select v-model="newVariant.type" class="v-select">
                    <option value="Size">Size</option>
                    <option value="Weight">Weight</option>
                    <option value="Pack">Pack</option>
                 </select>
                 <input v-model="newVariant.label" placeholder="Label (e.g. 500g)" class="v-input" />
                 <input v-model="newVariant.variantId" placeholder="ID (unique)" class="v-input" style="flex:0.8" />
                 <input v-model="newVariant.price" type="number" placeholder="Price (₹)" class="v-input" />
                 <input v-model="newVariant.stock" type="number" placeholder="Stock" class="v-input" style="flex:0.6" />
                 <button type="button" class="btn-outline-add" @click="addVariant">Add</button>
             </div>
             <div class="variants-list" v-if="form.variants.length > 0">
                 <div class="v-badge" v-for="(v, i) in form.variants" :key="v.variantId || i">
                     <div class="v-static-fields">
                       <strong>{{v.type}}:</strong> {{v.label}}
                       <span class="v-immutable-chip" :title="`Variant ID is immutable: ${v.variantId}`">ID: {{ v.variantId }}</span>
                     </div>

                     <template v-if="editingVariantIdx === i">
                       <label>Price (₹)<input type="number" min="0" step="0.01" v-model.number="v.price" /></label>
                       <label>Stock<input type="number" min="0" step="1" v-model.number="v.stock" /></label>
                       <label class="variant-active-toggle">
                         <input type="checkbox" v-model="v.active" />
                         Active
                       </label>
                       <button type="button" class="v-save" @click="saveVariantEdits">Save</button>
                       <button type="button" class="v-cancel" @click="cancelEditVariant">Cancel</button>
                     </template>

                     <template v-else>
                       <span :class="['v-pill', v.active ? 'pill-green' : 'pill-amber']">₹{{ v.price }}</span>
                       <span :class="['v-pill', (Number(v.stock) || 0) > 0 ? 'pill-green' : 'pill-amber']">Stock: {{ v.stock }}</span>
                       <span :class="['v-pill', v.active ? 'pill-green' : 'pill-amber']">{{ v.active ? 'Active' : 'Hidden' }}</span>
                       <button type="button" class="v-edit" @click="startEditVariant(i)">Edit</button>
                       <button type="button" @click="removeVariant(i)" class="remove-variant-btn">✕</button>
                     </template>
                 </div>
             </div>
             <p v-else style="color:#dc2626; font-size:0.85rem; font-weight: 500; margin-top: 10px;">Note: You must add at least one variant.</p>
          </div>
          
          <div class="divider full-width">Discount Promotion</div>
          <div class="input-group toggle-box"><label>Enable Discount</label><input type="checkbox" v-model="form.discount.isDiscounted" /></div>
          <div class="input-group" v-if="form.discount.isDiscounted"><label>Discount (%)</label><input v-model="form.discount.percent" type="number" min="0" max="100" /></div>
          
          <div class="full-width math-display-panel" v-if="form.variants.length > 0 && form.discount.isDiscounted">
            <div class="math-panel-title">Price Preview (Based on 1st Variant)</div>
            <div class="math-grid-summary">
              <div class="math-node-card"><span class="math-label">Base Price</span><span class="math-number">₹{{ previewBasePrice }}</span></div>
              <div class="math-node-card text-orange"><span class="math-label">Discount</span><span class="math-number">-₹{{ calculatedSavingsAmount }}</span></div>
              <div class="math-node-card text-green"><span class="math-label">Final Cost</span><span class="math-number">₹{{ calculatedFinalPrice }}</span></div>
            </div>
          </div>
        </div>

        <div v-show="activeTab === 'detail'" class="grid-layout">
          <div class="input-group full-width"><label>Full Description</label><textarea class="preserves-lines" v-model="form.description"></textarea></div>
          <div class="input-group full-width"><label>Directions / How To Use</label><textarea class="preserves-lines" v-model="form.howToUse"></textarea></div>
          <div class="input-group full-width"><label>Origin</label><input v-model="form.origin" /></div>
          
          <div class="divider full-width">Benefits</div>
          <div class="full-width list-stack">
            <div v-for="(_, i) in form.benefits" :key="'b'+i" class="list-item-row"><input v-model="form.benefits[i]" /><button type="button" @click="removeArrayItem('benefits', i)" v-if="form.benefits.length > 1">✕</button></div>
            <button type="button" class="add-row-btn" @click="addArrayItem('benefits')">+ Add Benefit</button>
          </div>
          <div class="divider full-width">Ingredients</div>
          <div class="full-width list-stack">
            <div v-for="(_, i) in form.ingredients" :key="'ing'+i" class="list-item-row"><input v-model="form.ingredients[i]" /><button type="button" @click="removeArrayItem('ingredients', i)" v-if="form.ingredients.length > 1">✕</button></div>
            <button type="button" class="add-row-btn" @click="addArrayItem('ingredients')">+ Add Ingredient</button>
          </div>
        </div>

        <div v-show="activeTab === 'media'" class="grid-layout">
          <div class="full-width device-upload-box">
            <input type="file" multiple accept="image/*" @change="handleLocalImageUpload" :disabled="isUploadingImages" />
            <span v-if="uploadStatusText">{{ uploadStatusText }}</span>
          </div>

          <div class="full-width managed-image-grid">
             <div v-for="(imgItem, idx) in storageImages" :key="idx" :class="['managed-img-card', { 'is-primary-card': form.imageUrls[0] === getRawUrl(imgItem), 'is-hidden-card': !isVisibleToUser(getRawUrl(imgItem)) }]">
                <div class="img-wrapper">
                   <img :src="getRawUrl(imgItem)" />
                   <div v-if="getImgNote(imgItem)" class="compression-note">{{ getImgNote(imgItem) }}</div>
                </div>
                <div class="img-actions-tray">
                   <button type="button" class="action-btn" @click="makePrimary(getRawUrl(imgItem))">Primary</button>
                   <button type="button" class="action-btn" @click="toggleSelection(getRawUrl(imgItem))">Visibility</button>
                   <button type="button" class="action-btn text-danger" @click="removeStorageImage(getRawUrl(imgItem))">Delete</button>
                </div>
             </div>
          </div>
        </div>

        <div class="form-footer-actions">
          <button type="button" class="cancel-back-btn" @click="router.push('/admin')">Cancel</button>
          <button type="submit" class="commit-btn" :disabled="saving || isUploadingImages">{{ saving ? 'Saving...' : 'Save Product' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* ── Same as before, with small additions ── */
.form-workspace-page { min-height: 100vh; background-color: #f8fafc; padding: 100px 20px 40px; box-sizing: border-box; font-family: 'Inter', system-ui, sans-serif; color: #334155; }
.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; color: #475569; }
.spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top-color: #3b82f6; border-radius: 50%; animation: rot .8s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }
.form-container { max-width: 800px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); overflow: hidden; }
.form-header { padding: 24px; border-bottom: 1px solid #e2e8f0; background: #fafafa; }
.back-link-btn { background: none; border: none; color: #64748b; font-weight: 500; cursor: pointer; padding: 0; margin-bottom: 12px; font-size: 13px; }
.form-header h2 { margin: 0 0 16px; font-size: 1.25rem; color: #0f172a; font-weight: 600; }
.tabs-row { display: flex; gap: 8px; border-bottom: 1px solid #e2e8f0; }
.tab-btn { padding: 10px 16px; background: none; border: none; font-size: 14px; font-weight: 500; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; }
.tab-btn.active { color: #0f172a; border-bottom-color: #0f172a; font-weight: 600; }
.tab-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.core-product-form { padding: 32px; }
.grid-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.full-width { grid-column: 1 / -1; }
.divider { font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-top: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
.input-group { display: flex; flex-direction: column; gap: 6px; }
.input-group label { font-size: 13px; font-weight: 500; color: #334155; }
.input-group input, .input-group select, .input-group textarea { padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; background: #ffffff; color: #0f172a; width: 100%; box-sizing: border-box; outline: none; font-family: inherit;}
.input-group input:focus, .input-group textarea:focus { border-color: #0f172a; }
.input-group textarea { height: 110px; resize: vertical; }
.preserves-lines { white-space: pre-wrap; }
.toggle-box { flex-direction: row; justify-content: space-between; align-items: center; background: #fafafa; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; }
.variants-builder-box { background: #fafafa; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
.variants-row { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.v-select, .v-input { padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-family: inherit; font-size: 13px; flex:1; min-width:80px; }
.v-select:focus, .v-input:focus { border-color: #0f172a; outline: none; }
.btn-outline-add { background: white; border: 1px solid #cbd5e1; padding: 10px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; color: #334155; white-space:nowrap; }
.variants-list { display: flex; flex-direction: column; gap: 8px; }
.v-badge { background: #ffffff; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.v-badge > label { display: flex; flex-direction: column; font-size: 0.7rem; font-weight: 600; color: #64748b; gap: 2px; min-width: 80px; }
.v-badge > label input { width: 80px; padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: inherit; font-size: 0.95rem; color: #0f172a; font-weight: 600; }
.v-static-fields { display: flex; gap: 6px; align-items: center; min-width: 140px; flex-wrap: wrap; }
.v-immutable-chip { background: #f1f5f9; color: #475569; font-family: monospace; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px; }
.v-pill { padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; }
.v-pill.pill-green { background: #dcfce7; color: #166534; }
.v-pill.pill-amber { background: #fef3c7; color: #92400e; }
.v-edit, .v-save, .v-cancel { background: white; border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 0.75rem; font-weight: 600; color: #334155; }
.v-save { background: #0f172a; color: #fff; border-color: #0f172a; }
.v-cancel { color: #92400e; border-color: #fde68a; }
.v-edit:hover { background: #f1f5f9 }
.v-badge .variant-stock { background: #e2e8f0; padding: 0 6px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; }
.v-badge .variant-active-toggle { flex-direction: row; align-items: center; gap: 4px; font-size: 0.75rem; }
.v-badge .remove-variant-btn { background: #fef2f2; color: #ef4444; border: none; border-radius: 4px; width: 22px; height: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px; }
.list-stack { display: flex; flex-direction: column; gap: 8px; }
.list-item-row { display: flex; gap: 8px; }
.add-row-btn { background: #fafafa; color: #334155; border: 1px dashed #cbd5e1; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px; }
.form-footer-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
.cancel-back-btn { background: white; border: 1px solid #cbd5e1; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; color: #334155; }
.commit-btn { background: #0f172a; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; cursor: pointer; font-weight: 500; }
.commit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.fade-in { animation: fIn 0.2s ease-out; }

.math-display-panel { background-color: #fafafa; border: 1px dashed #cbd5e1; padding: 16px; border-radius: 8px; margin-top: 10px; }
.math-panel-title { font-size: 12px; color: #64748b; margin-bottom: 12px; font-weight: 500; }
.math-grid-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.math-node-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
.math-label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; }
.math-number { font-size: 16px; font-weight: 600; color: #0f172a; }
.text-orange .math-number { color: #d97706; }
.text-green .math-number { color: #16a34a; }

.device-upload-box { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 24px; text-align: center; }
.managed-image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-top: 8px; }
.managed-img-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; position: relative; }
.img-wrapper { width: 100%; aspect-ratio: 1; background: #f1f5f9; display: flex; align-items: center; justify-content: center; position: relative;}
.img-wrapper img { width: 100%; height: 100%; object-fit: cover; }
.compression-note { position: absolute; bottom: 0; left: 0; width: 100%; background: rgba(15,23,42,0.8); color: white; font-size: 11px; padding: 6px; text-align: center; z-index: 2; font-weight: 500; }
.img-actions-tray { display: flex; border-top: 1px solid #e2e8f0; background: #fafafa; }
.action-btn { flex: 1; padding: 10px 4px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; background: transparent; border-right: 1px solid #e2e8f0; color: #334155; }
.action-btn:last-child { border-right: none; }
.action-btn:hover { background: #f1f5f9; }
.text-danger { color: #ef4444; }

.visibility-toggle { padding: 14px 16px; border-radius: 10px; border: 1px solid; transition: 0.2s; }
.visibility-toggle.is-visible { background: #ECFDF5; border-color: #6EE7B7; }
.visibility-toggle.is-hidden  { background: #FEF2F2; border-color: #FCA5A5; }
.visibility-label { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
.visibility-label input[type='checkbox'] { width: 18px; height: 18px; margin-top: 3px; cursor: pointer; }
.visibility-label-text { display: flex; flex-direction: column; gap: 4px; }
.visibility-label-text small { color: #475569; font-size: 0.78rem; font-weight: 400; }

@media (max-width: 768px) {
  .form-workspace-page { padding: 80px 16px 40px; }
  .grid-layout { grid-template-columns: 1fr; gap: 16px; }
  .tabs-row { overflow-x: auto; white-space: nowrap; padding-bottom: 4px; }
  .form-container { border-radius: 8px; }
  .form-header, .core-product-form { padding: 16px; }
  .math-grid-summary { grid-template-columns: 1fr; }
  .variants-row { flex-direction: column; gap: 8px; }
  .v-select, .v-input, .btn-outline-add { width: 100%; box-sizing: border-box; }
  .managed-image-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
  .form-footer-actions { flex-direction: column; gap: 12px; }
  .cancel-back-btn, .commit-btn { width: 100%; text-align: center; }
}
</style>