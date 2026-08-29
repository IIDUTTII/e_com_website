<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetchActiveProducts } from './db.js'

defineOptions({ name: 'Home' })
const router = useRouter()
const activeFilter = ref('All')
const filters = ['All', 'Ghee & Oils', 'Juices', 'Spices & Herbs', 'Sweets']

const allProducts = ref([])
const loading = ref(true)
const displayLimit = ref(8)

onMounted(async () => {
  try {
    loading.value = true
    allProducts.value = await fetchActiveProducts()
  } catch (e) {
    console.error('Home mount error:', e)
  } finally {
    loading.value = false
  }
})

const generateSlug = (name) =>
  name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') : 'product'
const goToProduct = (product) =>
  router.push(`/product/${generateSlug(product.name)}--${product.id}`)

const products = computed(() =>
  activeFilter.value === 'All'
    ? allProducts.value
    : allProducts.value.filter((p) => p.category === activeFilter.value)
)
const visibleProducts = computed(() => products.value.slice(0, displayLimit.value))

const setFilter = (f) => {
  activeFilter.value = f
  displayLimit.value = 8
}
const hasDiscount = (p) => p.discount?.isDiscounted && p.discount?.percent > 0
const isOutOfStock = (p) => p.stock === 0

const getMinBasePrice = (p) => {
  if (p.variants && p.variants.length > 0)
    return Math.min(...p.variants.map((v) => Number(v.price)))
  return p.price || 0
}
const displayPrice = (p) => {
  const minBase = getMinBasePrice(p)
  return hasDiscount(p) ? Math.round(minBase * (1 - p.discount.percent / 100)) : minBase
}
const primaryImage = (p) => p.imageUrls?.find((u) => u?.trim()) ?? null
</script>

<template>
  <div class="page">
    <div class="page-inner">
      <!-- Softer hero — not a heavy full-bleed block on mobile -->
      <header class="hero">
        <div class="hero-inner">
          <div class="hero-badge">🌿 100% Natural · Handmade in the Himalayas</div>
          <h1 class="hero-title">Pure mountain goodness,<br />delivered to your door</h1>
          <p class="hero-sub">No preservatives · Ethically sourced · Plastic-free packaging</p>
          <p class="hero-demo">Testing phase — demo products only</p>
        </div>
      </header>

      <div class="content">
        <!-- Section head + filters -->
        <div class="section-head">
          <div class="section-title-row">
            <h2 class="section-title">
              <span class="leaf">🌱</span>
              From our hills to your home
            </h2>
            <span class="count-pill">{{ products.length }}</span>
          </div>

          <div class="filter-scroll">
            <div class="filter-pills">
              <button
                v-for="f in filters"
                :key="f"
                type="button"
                :class="['pill', { active: activeFilter === f }]"
                @click="setFilter(f)"
              >
                {{ f }}
              </button>
            </div>
          </div>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="product-grid">
          <div v-for="i in 8" :key="'sk-' + i" class="skeleton-card">
            <div class="skeleton-thumb"></div>
            <div class="skeleton-line w70"></div>
            <div class="skeleton-line w40"></div>
          </div>
        </div>

        <!-- Empty -->
        <div v-else-if="products.length === 0" class="empty-state">
          <span class="empty-icon">🍃</span>
          <p>No products in this category yet.</p>
        </div>

        <!-- Products -->
        <div v-else>
          <div class="product-grid">
            <article
              v-for="product in visibleProducts"
              :key="product.id"
              class="product-card"
              @click="goToProduct(product)"
            >
              <div class="product-thumb">
                <div v-if="isOutOfStock(product)" class="banner sold-out">Sold out</div>
                <div v-else-if="hasDiscount(product)" class="banner discount">
                  {{ product.discount.percent }}% off
                </div>

                <img
                  v-if="primaryImage(product)"
                  :src="primaryImage(product)"
                  :alt="product.name"
                  class="thumb-img"
                  loading="lazy"
                />
                <div v-else class="emoji-fallback">
                  <span>{{ product.emoji || '🌾' }}</span>
                </div>
              </div>

              <div class="product-body">
                <h3 class="product-name">{{ product.name }}</h3>
                <p class="product-desc">{{ product.shortDesc || 'Pure Himalayan product' }}</p>
                <div class="product-price-row">
                  <span class="product-price">₹{{ displayPrice(product) }}</span>
                  <span v-if="hasDiscount(product)" class="price-original">
                    ₹{{ getMinBasePrice(product) }}
                  </span>
                </div>
              </div>
            </article>
          </div>

          <div v-if="products.length > displayLimit" class="load-more-wrap">
            <button type="button" class="load-more-btn" @click="displayLimit += 8">
              Discover more
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── BASE ─── */
.page {
  background: #fafaf8;
  min-height: 100vh;
  width: 100%;
  color: #1a2a1a;
  font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  padding-top: 40px;
  overflow-x: hidden;
}
.page-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 20px 72px;
}

/* ─── HERO (soft, framed — works on mobile) ─── */
.hero {
  margin-bottom: 36px;
}
.hero-inner {
  background: linear-gradient(145deg, #163528 0%, #0f241c 55%, #1a3d2c 100%);
  border-radius: 20px;
  padding: 48px 36px 44px;
  text-align: center;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.06) inset,
    0 16px 40px rgba(11, 31, 21, 0.18);
}
.hero-inner::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 20% 0%, rgba(167, 243, 208, 0.12), transparent 55%),
    radial-gradient(ellipse 60% 50% at 90% 100%, rgba(46, 125, 50, 0.15), transparent 50%);
  pointer-events: none;
}
.hero-badge {
  position: relative;
  display: inline-block;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding: 7px 16px;
  border-radius: 40px;
  font-size: 12px;
  font-weight: 600;
  color: #e8f5e9;
  margin-bottom: 20px;
  letter-spacing: 0.3px;
}
.hero-title {
  position: relative;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 600;
  color: #fff;
  line-height: 1.2;
  margin: 0 0 14px;
  letter-spacing: -0.3px;
}
.hero-sub {
  position: relative;
  font-size: 15px;
  color: #a7f3d0;
  font-weight: 500;
  margin: 0 0 10px;
  letter-spacing: 0.2px;
}
.hero-demo {
  position: relative;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  font-weight: 500;
  margin: 0;
}

/* ─── SECTION HEAD ─── */
.content {
  padding: 0 2px;
}
.section-head {
  margin-bottom: 28px;
}
.section-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.section-title {
  font-size: 15px;
  font-weight: 700;
  color: #1a2a1a;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.leaf {
  font-size: 14px;
}
.count-pill {
  background: #eef2ee;
  color: #4a5c4a;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
}

/* Horizontal scroll filters on mobile, wrap on desktop */
.filter-scroll {
  margin: 0 -4px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.filter-scroll::-webkit-scrollbar {
  display: none;
}
.filter-pills {
  display: flex;
  gap: 8px;
  padding: 2px 4px 6px;
  width: max-content;
  min-width: 100%;
}
.pill {
  all: unset;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid #e2e6e2;
  padding: 8px 16px;
  border-radius: 40px;
  font-size: 13px;
  font-weight: 600;
  color: #4a5c4a;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}
.pill:hover {
  border-color: #b7c9b7;
  background: #f6f8f6;
}
.pill.active {
  background: #1b422e;
  border-color: #1b422e;
  color: #fff;
  box-shadow: 0 4px 12px rgba(27, 66, 46, 0.25);
}

/* ─── PRODUCT GRID ─── */
.product-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  align-items: stretch;
}
.product-card {
  background: #fff;
  border: 1px solid #e8ece8;
  border-radius: 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.product-card:hover {
  border-color: #c5d4c5;
  box-shadow: 0 8px 24px rgba(27, 66, 46, 0.08);
  transform: translateY(-2px);
}

.product-thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  background: #f7f9f7;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 12px;
  transition: transform 0.3s ease;
}
.product-card:hover .thumb-img {
  transform: scale(1.04);
}
.emoji-fallback {
  font-size: 42px;
  opacity: 0.7;
}

.banner {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  font-size: 10px;
  font-weight: 800;
  padding: 5px 9px;
  border-radius: 6px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.banner.discount {
  background: #1b422e;
  color: #fff;
}
.banner.sold-out {
  background: #5b6560;
  color: #fff;
}

.product-body {
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.product-name {
  font-size: 14px;
  font-weight: 650;
  color: #1a2a1a;
  margin: 0;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.product-desc {
  font-size: 12px;
  color: #6b7a6b;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.product-price-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 6px;
}
.product-price {
  font-size: 15px;
  font-weight: 700;
  color: #1a2a1a;
}
.price-original {
  font-size: 12px;
  color: #9aa69a;
  text-decoration: line-through;
}

/* ─── LOAD MORE / EMPTY / SKELETON ─── */
.load-more-wrap {
  text-align: center;
  margin-top: 36px;
}
.load-more-btn {
  all: unset;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid #d5ddd5;
  color: #1a2a1a;
  padding: 12px 28px;
  border-radius: 40px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.load-more-btn:hover {
  background: #f4f7f4;
  border-color: #1b422e;
  box-shadow: 0 4px 14px rgba(27, 66, 46, 0.1);
}
.empty-state {
  text-align: center;
  padding: 56px 20px;
  color: #6b7a6b;
}
.empty-icon {
  font-size: 2rem;
  display: block;
  margin-bottom: 10px;
}
.skeleton-card {
  background: #fff;
  border: 1px solid #e8ece8;
  border-radius: 16px;
  overflow: hidden;
  padding-bottom: 14px;
}
.skeleton-thumb {
  aspect-ratio: 1;
  background: linear-gradient(90deg, #eef1ee 25%, #f6f8f6 50%, #eef1ee 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease infinite;
}
.skeleton-line {
  height: 12px;
  border-radius: 6px;
  margin: 12px 14px 0;
  background: #eef1ee;
}
.skeleton-line.w70 {
  width: 70%;
}
.skeleton-line.w40 {
  width: 40%;
}
@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* ─── TABLET ─── */
@media (max-width: 1024px) {
  .product-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
}

/* ─── MOBILE ─── */
@media (max-width: 768px) {
  .page {
    padding-top: 16px;
    background: #fafaf8;
  }
  .page-inner {
    padding: 12px 14px 56px;
  }

  /* Framed hero on mobile — keeps border/outline, no full-bleed heavy block */
  .hero {
    margin-bottom: 24px;
  }
  .hero-inner {
    border-radius: 16px;
    padding: 32px 20px 28px;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.06) inset,
      0 10px 28px rgba(11, 31, 21, 0.14);
  }
  .hero-badge {
    font-size: 11px;
    padding: 6px 12px;
    margin-bottom: 14px;
  }
  .hero-title {
    font-size: 1.55rem;
    margin-bottom: 10px;
  }
  .hero-sub {
    font-size: 13px;
    line-height: 1.45;
  }
  .hero-demo {
    font-size: 11px;
    margin-top: 4px;
  }

  .section-head {
    margin-bottom: 20px;
  }
  .section-title {
    font-size: 14px;
  }

  .product-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  .product-card {
    border-radius: 14px;
  }
  .product-thumb {
    border-radius: 0;
  }
  .thumb-img {
    padding: 8px;
  }
  .product-body {
    padding: 10px 11px 12px;
  }
  .product-name {
    font-size: 13px; 768px
  }
  .product-desc {
    font-size: 11px;
  }
  .product-price {
    font-size: 14px;
  }
  .banner {
    top: 8px;
    left: 8px;
    font-size: 9px;
    padding: 4px 7px;
  }
}

@media (max-width: 380px) {
  .product-grid {
    gap: 10px;
  }
  .hero-title {
    font-size: 1.35rem;
  }
}
</style>
