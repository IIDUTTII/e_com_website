<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auth } from '../firebase.js'
import { 
  fetchProductById, logProductView, addProductToCart, 
  isVariantInCart, fetchProductReviews, addProductReview, canUserReviewProduct,
  deleteProductReview, fetchUserRole
} from './db.js'

defineOptions({ name: 'ProductDetail' })
const route = useRoute(), router = useRouter()

const product = ref(null), loading = ref(true), notFound = ref(false)
const isUnavailable = computed(() => product.value && product.value.isActive === false)
const adding = ref(false), alreadyInCart = ref(false)

const activeIdx = ref(0), brokenUrls = ref(new Set())
const activeDetailTab = ref('description')
const reviewsList = ref([]), newRating = ref(5), newComment = ref(''), submitting = ref(false)
const canReview = ref(false) 

const currentUserUid = ref(null)
const userRole = ref('user')

const selectedVariant = ref(null)
const selectedQuantity = ref(1)

// ─── COMPUTED ───
const cleanImages = computed(() => {
  // Get images from selected variant first, fallback to product images
  if (selectedVariant.value?.imageUrls && selectedVariant.value.imageUrls.length > 0) {
    return selectedVariant.value.imageUrls.filter(u => u && u.trim() !== '' && !brokenUrls.value.has(u));
  }
  return (product.value?.imageUrls || []).filter(u => u && u.trim() !== '' && !brokenUrls.value.has(u));
})

// Get all variant images for the tray
const allVariantImages = computed(() => {
  if (!product.value?.variants) return [];
  const all = [];
  product.value.variants.forEach(v => {
    if (v.imageUrls && v.imageUrls.length > 0) {
      v.imageUrls.forEach(url => {
        if (url && url.trim() !== '' && !brokenUrls.value.has(url)) {
          all.push({ url, variantLabel: v.label });
        }
      });
    }
  });
  return all;
})

const safeVariants = computed(() => {
  if (product.value?.variants && product.value.variants.length > 0) {
    return product.value.variants;
  }
  // No variants – return empty array
  return [];
})

const hasDiscount = computed(() => product.value?.discount?.isDiscounted && product.value?.discount?.percent > 0)
const isOutOfStock = computed(() => {
  if (!selectedVariant.value) return true;
  return Number(selectedVariant.value.stock || 0) <= 0;
})

const currentBasePrice = computed(() => Number(selectedVariant.value?.price || 0))
const finalPrice = computed(() => hasDiscount.value ? Math.round(currentBasePrice.value * (1 - product.value.discount.percent / 100)) : currentBasePrice.value)

const zoomStyle = ref({})

// ─── WATCHERS ───
watch(selectedVariant, async (newVar) => {
  if (product.value && newVar) {
    alreadyInCart.value = await isVariantInCart(product.value.id, newVar.label || newVar.variantId)
    selectedQuantity.value = 1
    // Reset image index when variant changes
    activeIdx.value = 0
  }
})

// ─── ZOOM FUNCTIONS ───
const handleZoom = (e) => {
  if (window.innerWidth < 768) return
  const { left, top, width, height } = e.target.getBoundingClientRect()
  const x = ((e.clientX - left) / width) * 100
  const y = ((e.clientY - top) / height) * 100
  zoomStyle.value = {
    transformOrigin: `${x}% ${y}%`,
    transform: 'scale(2)'
  }
}

const resetZoom = () => {
  zoomStyle.value = {
    transformOrigin: 'center center',
    transform: 'scale(1)'
  }
}

// ─── LIFEHOOK ───
onMounted(async () => {
  const rawParam = route.params.id
  const productId = rawParam.includes('--') ? rawParam.split('--').pop() : rawParam

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUserUid.value = user.uid;
      userRole.value = await fetchUserRole();
    }
  })

  try {
    product.value = await fetchProductById(productId)
    if (!product.value) { notFound.value = true; return }
    
    if (safeVariants.value.length > 0) {
      selectedVariant.value = safeVariants.value[0];
    }
    
    reviewsList.value = await fetchProductReviews(product.value.id)
    canReview.value = await canUserReviewProduct(product.value.id)
    logProductView(product.value.id)
  } catch (e) { notFound.value = true } finally { loading.value = false }
})

// ─── ACTIONS ───
const increaseQty = () => selectedQuantity.value++
const decreaseQty = () => { if(selectedQuantity.value > 1) selectedQuantity.value-- }

async function handleAddToCart() {
  if (alreadyInCart.value) { router.push('/cart'); return }
  if (adding.value || isOutOfStock.value) return
  if (isUnavailable.value) return  // belt-and-suspenders: never add a hidden product
  if (!selectedVariant.value) { alert("Please select an option."); return; }

  adding.value = true
  try {
    await addProductToCart(product.value, finalPrice.value, selectedVariant.value, selectedQuantity.value)
    alreadyInCart.value = true
  } catch (err) {
    alert(err.message === 'NOT_LOGGED_IN' ? 'Please log in to add items to cart.' : 'Error: ' + err.message)
  } finally { adding.value = false }
}

async function handleReviewSubmit() {
  if (!newComment.value.trim()) return
  submitting.value = true
  try {
    await addProductReview(product.value.id, newRating.value, newComment.value)
    reviewsList.value = await fetchProductReviews(product.value.id)
    newComment.value = ''; newRating.value = 5; alert('Review submitted successfully.')
  } catch (err) { alert(err.message) } finally { submitting.value = false }
}

async function handleDeleteReview(reviewId) {
  if (!confirm("Are you sure you want to delete this review?")) return;
  try {
    await deleteProductReview(reviewId);
    reviewsList.value = reviewsList.value.filter(r => r.id !== reviewId);
  } catch (e) { alert("Error deleting review: " + e.message); }
}

let touchStartX = 0
const onTouchStart = (e) => { touchStartX = e.changedTouches[0].screenX }
const onTouchEnd = (e) => {
  const touchEndX = e.changedTouches[0].screenX
  if (touchStartX - touchEndX > 40) nextImage()
  if (touchEndX - touchStartX > 40) prevImage()
}
const prevImage = () => { if(activeIdx.value > 0) activeIdx.value-- }
const nextImage = () => { if(activeIdx.value < cleanImages.value.length - 1) activeIdx.value++ }
</script>

<template>
  <div class="page">
    
    <div v-if="loading" class="center-state"><div class="spinner"></div></div>
    <div v-else-if="notFound" class="center-state text-404">
      <h3>Product Not Found</h3>
      <button class="primary-cta" @click="router.push('/products')">Return to Shop</button>
    </div>
    <div v-else-if="isUnavailable" class="center-state text-404">
      <h3>Currently Unavailable</h3>
      <p>This product has been temporarily paused by our team. Please check back later.</p>
      <button class="primary-cta" @click="router.push('/products')">Browse Other Products</button>
    </div>

    <div v-else-if="product" class="product-viewport-container fade-in">
      <div class="main-split-grid">
        
        <!-- ─── ENLARGED GALLERY (Left) ─── -->
        <div class="gallery-pane">
          <div class="gallery-sticky-wrapper">
            
            <!-- Main Image (Enlarged, Borderless, White BG) -->
            <div class="focused-display-box" @touchstart="onTouchStart" @touchend="onTouchEnd">
              <!-- Premium Blinkit Style Badges -->
              <div v-if="isOutOfStock" class="premium-banner stockout">Out of Stock</div>
              <div v-else-if="hasDiscount" class="premium-banner discount">{{ product.discount.percent }}% OFF</div>
              
              <div 
                class="focused-image-aspect" 
                v-if="cleanImages.length > 0"
                @mousemove="handleZoom"
                @mouseleave="resetZoom"
              >
                <img 
                  :src="cleanImages[activeIdx] || cleanImages[0]" 
                  class="primary-focused-image" 
                  :style="zoomStyle"
                />
             
                <button v-if="cleanImages.length > 1 && activeIdx > 0" class="slide-btn prev" @click.stop="prevImage">&lt;</button>
                <button v-if="cleanImages.length > 1 && activeIdx < cleanImages.length - 1" class="slide-btn next" @click.stop="nextImage">&gt;</button>
                
                <div class="mobile-slider-dots" v-if="cleanImages.length > 1">
                  <span v-for="(_, i) in cleanImages" :key="i" :class="['dot', { active: activeIdx === i }]" @click.stop="activeIdx = i"></span>
                </div>
              </div>
              <div v-else class="no-image-fallback"><span>No Image Available</span></div>
            </div>

            <!-- Horizontal Thumbnail Strip (Moved Below) -->
            <div v-if="cleanImages.length > 1" class="bottom-strip-tray">
              <div v-for="(url, idx) in cleanImages" :key="url" :class="['strip-thumb-card', { 'is-active': activeIdx === idx }]" @click="activeIdx = idx">
                <img :src="url"/>
              </div>
            </div>

          </div>
        </div>

        <!-- ─── BUY PANE & DETAILS (Right) ─── -->
        <div class="quick-buy-pane">
          <div class="header-group">
            <span class="category-meta-header">{{ product.category || 'HIMALAYAN ESSENTIAL' }}</span>
            <h1 class="item-title">{{ product.name }}</h1>
            <p class="product-short-desc" v-if="product.shortDesc">{{ product.shortDesc }}</p>
          </div>

          <div v-if="product.reviewCount > 0" class="rating-row">
            <span class="stars-badge">★ {{ product.ratingAverage?.toFixed(1) }}</span>
            <span class="review-aggregate-count">{{ product.reviewCount }} Ratings</span>
          </div>

          <div class="pricing-block">
            <span class="current-price">₹{{ finalPrice }}</span>
            <div v-if="hasDiscount" class="price-discount-meta">
              <span class="struck-slashed-price">MRP ₹{{ currentBasePrice }}</span>
              <span class="savings-pill-alert">Save ₹{{ currentBasePrice - finalPrice }}</span>
            </div>
          </div>

          <!-- Variants Selection -->
          <div v-if="safeVariants.length > 0" class="variants-selection-block">
            <label class="variant-label">Select Size / Variant:</label>
            <div class="variant-options-tray">
              <button 
                v-for="v in safeVariants" 
                :key="v.variantId || v.label" 
                :class="['variant-btn', { active: selectedVariant === v }]" 
                @click="selectedVariant = v"
              >
                {{ v.label }}
              </button>
            </div>
          </div>

          <!-- Add to Cart (Borderless, Floating) -->
          <div class="cart-transactional-card">
            <div class="transaction-actions-row">
              <div v-if="!alreadyInCart && !isOutOfStock && selectedVariant" class="quantity-adjuster-box">
                <button class="qty-btn" @click="decreaseQty">-</button>
                <span class="qty-val">{{ selectedQuantity }}</span>
                <button class="qty-btn" @click="increaseQty">+</button>
              </div>

              <button 
                class="primary-cta" 
                :disabled="isOutOfStock || !selectedVariant || safeVariants.length === 0" 
                :class="{ 
                  'is-disabled': isOutOfStock || !selectedVariant || safeVariants.length === 0, 
                  'is-in-cart': alreadyInCart && !isOutOfStock 
                }" 
                @click="handleAddToCart"
              >
                <span v-if="adding">Processing...</span>
                <span v-else-if="safeVariants.length === 0">No Variants</span>
                <span v-else-if="isOutOfStock">Sold Out</span>
                <span v-else-if="alreadyInCart">Added to Cart</span>
                <span v-else>Add to Cart</span>
              </button>
            </div>
            
            <div class="stock-availability-bar">
              <span v-if="isOutOfStock" class="stock-txt dynamic-out">Currently out of stock</span>
              <span v-else class="stock-txt dynamic-good">✓ In Stock & Ready to Ship</span>
            </div>
          </div>

          <!-- Creative Space Filler: Trust Signals -->
          <div class="trust-signals-box">
            <div class="trust-item">
              <span class="trust-icon">🌿</span>
              <div class="trust-text"><strong>100% Pure & Natural</strong><br>No artificial preservatives.</div>
            </div>
            <div class="trust-item">
              <span class="trust-icon">🏔️</span>
              <div class="trust-text"><strong>Direct from Himalayas</strong><br>Ethically sourced from high altitudes.</div>
            </div>
            <div class="trust-item">
              <span class="trust-icon">♻️</span>
              <div class="trust-text"><strong>Eco-Friendly Packaging</strong><br>We care for the mountains.</div>
            </div>
          </div>

        </div>
      </div>

      <!-- ─── TABS & DETAILS (Borderless) ─── -->
      <div class="rich-details-section">
        <div class="rich-tabs-bar">
          <button :class="['rich-tab-nav-btn', { 'is-active': activeDetailTab === 'description' }]" @click="activeDetailTab = 'description'">Product Info</button>
          <button v-if="product.benefits?.length" :class="['rich-tab-nav-btn', { 'is-active': activeDetailTab === 'benefits' }]" @click="activeDetailTab = 'benefits'">Benefits</button>
          <button v-if="product.ingredients?.length" :class="['rich-tab-nav-btn', { 'is-active': activeDetailTab === 'nutrition' }]" @click="activeDetailTab = 'nutrition'">Ingredients</button>
          <button :class="['rich-tab-nav-btn', { 'is-active': activeDetailTab === 'info' }]" @click="activeDetailTab = 'info'">Specifications</button>
        </div>

        <div class="rich-tabs-content-body">
          <div v-show="activeDetailTab === 'description'" class="tab-fade-panel"><p class="paragraph-text">{{ product.description }}</p></div>
          <div v-show="activeDetailTab === 'benefits'" class="tab-fade-panel"><ul class="bullets-stack"><li v-for="benefit in product.benefits" :key="benefit">{{ benefit }}</li></ul></div>
          <div v-show="activeDetailTab === 'nutrition'" class="tab-fade-panel"><div class="ingredients-flex-tray"><span v-for="ing in product.ingredients" :key="ing" class="ing-node-pill">{{ ing }}</span></div></div>
          <div v-show="activeDetailTab === 'info'" class="tab-fade-panel">
            <table class="spec-table"><tbody>
              <tr v-if="product.origin"><td>Origin</td><td>{{ product.origin }}</td></tr>
              <tr v-if="product.shelfLife"><td>Shelf Life</td><td>{{ product.shelfLife }}</td></tr>
              <tr v-if="product.category"><td>Category</td><td>{{ product.category }}</td></tr>
            </tbody></table>
          </div>
        </div>
      </div>

      <!-- ─── REVIEWS ─── -->
      <div class="reviews-section">
        <h3 class="section-headline">Customer Reviews</h3>
        <div class="reviews-split-viewport">
          
          <div class="submit-review-card-form">
            <div v-if="canReview">
              <h4 class="form-title">Write a Review</h4>
              <form @submit.prevent="handleReviewSubmit" class="review-inline-form">
                <div class="form-row">
                  <select v-model="newRating" class="review-select-input">
                    <option :value="5">5 - Excellent</option>
                    <option :value="4">4 - Good</option>
                    <option :value="3">3 - Average</option>
                    <option :value="2">2 - Poor</option>
                    <option :value="1">1 - Terrible</option>
                  </select>
                </div>
                <div class="form-row flex-column"><textarea v-model="newComment" required placeholder="Share your experience..." class="review-textarea"></textarea></div>
                <button type="submit" class="submit-review-btn" :disabled="submitting">Submit</button>
              </form>
            </div>
            <div v-else class="not-purchased-alert">
              <h4>Review Eligibility</h4><p>Reviews can only be submitted by verified customers.</p>
            </div>
          </div>

          <div class="live-reviews-feed-column">
            <div v-if="reviewsList.length === 0" class="empty-reviews-state"><p>Be the first to review this product!</p></div>
            <div v-else class="reviews-stack">
              <div v-for="review in reviewsList" :key="review.id" class="review-card">
                <div class="review-row-header">
                  <span class="user-id-badge">{{ review.userName || 'Verified Buyer' }} <span class="verified-tag">Verified</span></span>
                  <div class="review-actions-right">
                    <span class="star-rating-score">★ {{ review.rating }}</span>
                    <button v-if="currentUserUid === review.userId || ['admin', 'superadmin'].includes(userRole)" 
                            class="del-review-btn" @click="handleDeleteReview(review.id)" title="Delete Review">Delete</button>
                  </div>
                </div>
                <p class="review-text">{{ review.comment }}</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* ─── SYSTEM CORE & LAYOUT ─── */
.fade-in { animation: fIn 0.3s ease-out; }
@keyframes fIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

/* Matched background to Home (White) */
.page { padding:95px 24px 80px; font-family: 'Inter', -apple-system, sans-serif; min-height: 100vh; background-color: #ffffff; color: #111827; }


.back-link-action { background: transparent; border: none; color: #6B7280; font-weight: 500; font-size: 14px; cursor: pointer; padding: 0; transition: color 0.2s; font-family: inherit;}
.back-link-action:hover { color: #111827; }

.center-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 50vh; color: #64748B; gap: 12px; }
.center-state p { max-width: 420px; text-align: center; color: #94a3b8; }
.spinner { width: 36px; height: 36px; border: 3px solid #F3F4F6; border-top-color: #111827; border-radius: 50%; animation: spin 0.8s linear infinite; }

.product-viewport-container { width: 100%; max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 64px; }
.main-split-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 56px; align-items: start; }

/* ─── ENLARGED GALLERY (Left) ─── */
.gallery-sticky-wrapper { position: sticky; top: 100px; display: flex; flex-direction: column; gap: 16px; }

/* Main Image Box: No border, larger aspect ratio, white background */
.focused-display-box { 
  width: 100%; 
  background-color: #ffffff; 
  border-radius: 20px; 
  position: relative; 
  /* Subtle glow to ground it without harsh borders */
  box-shadow: 0 4px 30px rgba(0,0,0,0.03); 
}
.focused-image-aspect { 
  width: 100%; height: 560px; /* Taller image space */
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; border-radius: 20px; position: relative;
}
.primary-focused-image { width: 100%; height: 100%; object-fit: contain; cursor: crosshair; transition: transform 0.1s ease-out; padding: 20px;}

/* Horizontal Thumbnails */
.bottom-strip-tray { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
.strip-thumb-card { width: 80px; height: 80px; border-radius: 12px; border: 2px solid transparent; background-color: #F9FAFB; cursor: pointer; overflow: hidden; flex-shrink: 0; transition: all 0.2s; }
.strip-thumb-card.is-active { border-color: #111827; }
.strip-thumb-card img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }

/* Blinkit Style Banner */
.premium-banner { position: absolute; top: 0; left: 0; z-index: 2; font-size: 12px; font-weight: 800; padding: 6px 12px; border-radius: 20px 0 12px 0; letter-spacing: 0.2px; text-transform: uppercase; }
.premium-banner.discount { background: #2563EB; color: #ffffff; }
.premium-banner.stockout { background: #4B5563; color: #ffffff; }

/* ─── BUY PANE (Right) ─── */
.quick-buy-pane { display: flex; flex-direction: column; padding: 10px 0; }
.category-meta-header { font-size: 12px; font-weight: 700; color: #6B7280; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 1px;}
.item-title { font-size: 32px; font-weight: 600; color: #111827; margin: 0 0 12px 0; line-height: 1.2; letter-spacing: -0.5px; }
.product-short-desc { font-size: 15px; color: #4B5563; margin: 0 0 16px 0; line-height: 1.5; }

.rating-row { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; }
.stars-badge { font-size: 14px; font-weight: 600; color: #ffffff; background: #059669; padding: 4px 10px; border-radius: 6px;}
.review-aggregate-count { font-size: 14px; font-weight: 500; color: #6B7280; }

.pricing-block { display: flex; align-items: baseline; gap: 12px; margin-bottom: 32px; }
.current-price { font-size: 32px; font-weight: 700; color: #111827; }
.struck-slashed-price { font-size: 15px; color: #9CA3AF; text-decoration: line-through; }
.savings-pill-alert { background: #DCFCE7; color: #15803D; font-size: 12px; font-weight: 700; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

/* Variants */
.variants-selection-block { margin-bottom: 32px; }
.variant-label { font-size: 13px; font-weight: 600; color: #4B5563; margin-bottom: 12px; display: block; text-transform: uppercase; letter-spacing: 0.5px;}
.variant-options-tray { display: flex; flex-wrap: wrap; gap: 12px; }
.variant-btn { padding: 12px 24px; border: 1px solid #E5E7EB; background: #ffffff; border-radius: 40px; cursor: pointer; font-weight: 600; font-size: 14px; color: #4B5563; font-family: inherit; transition: all 0.2s;}
.variant-btn:hover { border-color: #D1D5DB; }
.variant-btn.active { border-color: #111827; color: #ffffff; background: #111827; }

/* Actions & Trust Signals */
.cart-transactional-card { margin-bottom: 24px; }
.transaction-actions-row { display: flex; gap: 16px; align-items: stretch; margin-bottom: 12px;}

.quantity-adjuster-box { display: flex; align-items: center; border: 1px solid #E5E7EB; border-radius: 12px; background: #ffffff; overflow: hidden;}
.qty-btn { background: transparent; border: none; font-size: 18px; color: #111827; width: 44px; height: 48px; cursor: pointer; transition: 0.2s; font-weight: 500; }
.qty-btn:hover { background: #F3F4F6; }
.qty-val { width: 36px; text-align: center; font-size: 15px; font-weight: 600; }

.primary-cta { flex: 1; padding: 0 24px; background-color: #3182CE; color: #ffffff; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; font-family: inherit; min-height: 48px;}
.primary-cta:hover:not(:disabled) { background-color: #2B6CB0; transform: translateY(-1px); }
.primary-cta.is-in-cart { background-color: #10B981; }
.primary-cta.is-disabled { background-color: #E5E7EB; color: #9CA3AF; cursor: not-allowed; transform: none; }

.stock-availability-bar { font-size: 13px; font-weight: 500; }
.dynamic-good { color: #059669; }
.dynamic-out { color: #DC2626; }

/* The new space filler / trust box */
.trust-signals-box { display: flex; flex-direction: column; gap: 16px; padding: 24px; background: #F9FAFB; border-radius: 16px; margin-top: 32px; }
.trust-item { display: flex; align-items: center; gap: 16px; }
.trust-icon { font-size: 24px; }
.trust-text { font-size: 13px; color: #4B5563; line-height: 1.4; }
.trust-text strong { color: #111827; font-size: 14px; }

/* ─── TABS & DETAILS (Borderless) ─── */
.rich-details-section { width: 100%; margin-top: 20px;}
.rich-tabs-bar { display: flex; gap: 32px; border-bottom: 1px solid #E5E7EB; }
.rich-tab-nav-btn { padding: 0 0 16px 0; background: transparent; border: none; font-size: 15px; font-weight: 500; color: #6B7280; cursor: pointer; font-family: inherit; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.rich-tab-nav-btn.is-active { color: #111827; border-bottom-color: #111827; font-weight: 600; }
.rich-tabs-content-body { padding: 32px 0; }

.paragraph-text { font-size: 15px; color: #4B5563; line-height: 1.7; margin: 0; white-space: pre-wrap; }
.bullets-stack { list-style: disc; padding-left: 20px; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.bullets-stack li { font-size: 15px; color: #4B5563; }
.ing-node-pill { font-size: 13px; font-weight: 500; display: inline-block; background: #F3F4F6; padding: 8px 16px; border-radius: 40px; margin: 4px 8px 8px 0; color: #374151; }

.spec-table { width: 100%; border-collapse: collapse; max-width: 600px; }
.spec-table td { padding: 16px 0; border-bottom: 1px solid #F3F4F6; font-size: 15px; color: #4B5563; }
.spec-table td:first-child { font-weight: 600; color: #111827; width: 35%; }

/* ─── REVIEWS (Borderless) ─── */
.reviews-section { width: 100%; border-top: 1px solid #E5E7EB; padding-top: 48px; }
.section-headline { font-size: 24px; font-weight: 600; color: #111827; margin: 0 0 32px 0; letter-spacing: -0.5px;}

.reviews-split-viewport { display: flex; gap: 48px; align-items: start; }
.submit-review-card-form { width: 35%; background-color: #F9FAFB; border-radius: 16px; padding: 32px; position: sticky; top: 100px; }
.form-title { margin: 0 0 20px 0; font-size: 18px; font-weight: 600; color: #111827;}

.not-purchased-alert { text-align: left; }
.not-purchased-alert h4 { margin: 0 0 8px; font-size: 15px; color: #111827; }
.not-purchased-alert p { margin: 0; font-size: 14px; color: #6B7280; line-height: 1.5; }

.live-reviews-feed-column { width: 65%; }
.review-select-input, .review-textarea { padding: 14px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; width: 100%; margin-bottom: 16px; font-family: inherit; color: #111827; background: #ffffff; }
.review-textarea { height: 120px; resize: vertical; outline: none; }
.review-textarea:focus, .review-select-input:focus { border-color: #111827; }
.submit-review-btn { background-color: #111827; color: #ffffff; border: none; padding: 14px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; font-family: inherit; transition: 0.2s; }
.submit-review-btn:hover { background-color: #374151; }

.review-card { background-color: #ffffff; border-bottom: 1px solid #F3F4F6; padding: 24px 0; }
.review-card:last-child { border-bottom: none; }
.review-row-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.user-id-badge { font-size: 15px; color: #111827; font-weight: 600; display: flex; align-items: center; gap: 10px;}
.verified-tag { background: #DCFCE7; color: #15803D; font-size: 11px; padding: 4px 8px; border-radius: 20px; font-weight: 600; text-transform: uppercase;}
.review-text { font-size: 15px; color: #4B5563; line-height: 1.6; margin: 0; }

.review-actions-right { display: flex; align-items: center; gap: 12px; }
.star-rating-score { font-size: 14px; font-weight: 600; color: #ffffff; background: #059669; padding: 4px 10px; border-radius: 6px;}
.del-review-btn { background: transparent; border: none; color: #EF4444; font-size: 13px; cursor: pointer; padding: 6px 12px; border-radius: 6px; transition: 0.2s; font-weight: 500;}
.del-review-btn:hover { background: #FEF2F2; }

/* ─── SLIDE BTNS (Desktop) ─── */
.slide-btn { position: absolute; top: 50%; transform: translateY(-50%); background: #ffffff; border: none; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 40px; height: 40px; border-radius: 50%; font-size: 16px; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: 0.2s; color: #111827; }
.focused-display-box:hover .slide-btn { opacity: 1; }
.slide-btn.prev { left: 16px; }
.slide-btn.next { right: 16px; }
.mobile-slider-dots { position: absolute; bottom: 16px; left: 0; width: 100%; display: none; justify-content: center; gap: 6px; z-index: 10; }
.mobile-slider-dots .dot { width: 8px; height: 8px; border-radius: 50%; background: #E5E7EB; cursor: pointer; transition: 0.2s; }
.mobile-slider-dots .dot.active { background: #111827; }

/* ─── MOBILE RESPONSIVENESS ─── */
@media (max-width: 900px) {
  .main-split-grid { grid-template-columns: 1fr; gap: 40px; }
  .focused-image-aspect { height: auto; aspect-ratio: 4/3; }
}

@media (max-width: 768px) {
  /* Added padding to clear fixed mobile navbars */
  .page { padding: 80px 16px 80px; } 
  .breadcrumb-container { display: none; /* Often hidden on mobile to save space */ }
  
  .bottom-strip-tray { display: none; } 
  .mobile-slider-dots { display: flex; }
  .slide-btn { display: none; }
  
  .focused-image-aspect { border-radius: 16px; aspect-ratio: 1/1; }
  .focused-display-box { border-radius: 16px; }
  
  .item-title { font-size: 24px; }
  .current-price { font-size: 28px; }
  
  .transaction-actions-row { flex-direction: column; }
  .quantity-adjuster-box { justify-content: space-between; width: 100%; }
  
  .rich-tabs-bar { overflow-x: auto; white-space: nowrap; gap: 20px; }
  .rich-tab-nav-btn { font-size: 14px; }
  .rich-tabs-content-body { padding: 24px 0; }
  
  .reviews-split-viewport { flex-direction: column; gap: 40px; }
  .submit-review-card-form, .live-reviews-feed-column { width: 100%; }
  .submit-review-card-form { position: static; padding: 24px; }
}
</style>
