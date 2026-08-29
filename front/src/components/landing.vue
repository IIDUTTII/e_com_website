<template>
  <div class="page">
    <div class="page-bg"></div>
    <svg style="display:none">
      <filter id="lg-dist" x="0%" y="0%" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="2" seed="92" result="noise"/>
        <feGaussianBlur in="noise" stdDeviation="2" result="blurred"/>
        <feDisplacementMap in="SourceGraphic" in2="blurred" scale="50" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </svg>

    <!-- LEAVES -->
    <div class="bg-scattered" id="leaf-container">
      <div v-for="(img, i) in currentScattered" :key="'leaf-' + i" class="leaf-item"
           :style="{ left: img.x + '%', top: img.y + '%', width: img.width + '%', transform: `rotate(${img.rotation}deg)` }">
        <img :src="img.src" alt="" draggable="false" loading="lazy"/>
      </div>
    </div>

    <!-- HERO -->
    <div class="hero-wrapper" :class="{ 'hero-settled': settled }">
      <div class="hero">
        <h1 class="brand" :class="{ 'brand-dark': settled }">
          <span class="pahad" :class="{ 'pahad-dark': settled }">{{ hero.title }}</span>
          <span class="s-wrap"><span class="s-color" :class="{ 's-color-dark': settled }">{{ hero.subtitle }}</span><span class="s-masked" :class="{ 's-masked-dark': settled }">S</span></span>
        </h1>
        <p class="tagline" :class="{ 'tagline-dark': settled }">{{ hero.tagline }}</p>
      </div>
    </div>
    <div class="reveal-bg"></div>

    <!-- CARDS (z-index raised so they sit above all text sections) -->
    <div class="card-field" :class="{ 'cards-visible': settled }">
      <div v-for="i in 5" :key="'skeleton-' + i" class="glass-card skeleton"
           :class="[['lg','sm','md','sm','md'][i-1]]"
           :style="{ transform: `translate3d(${getPosition(i-1).x}px, ${getPosition(i-1).y}px, 0) rotate(${cards[i-1]?.rotate || 0}deg)`, zIndex: 0, opacity: settled && !loadedCards[i-1] ? 1 : 0 }">
        <div class="skeleton-shimmer"></div>
      </div>
      <div v-for="(card, index) in cards" :key="card.id" class="glass-card"
           :class="[card.style, card.size, { 'card-loaded': loadedCards[index] }]"
           :style="{
             transform: `translate3d(${positions[card.id].x}px, ${positions[card.id].y}px, 0) rotate(${card.rotate}deg)`,
             zIndex: zIndexMap[card.id],
             opacity: loadedCards[index] ? 1 : 0
           }"
           @mousedown="startDrag($event, card.id)"
           @touchstart="startDragTouch($event, card.id)">
        <!-- labels removed for cleaner look -->
        <div v-if="card.style === 'distort'" class="glass-filter"></div>
        <div class="glass-overlay"></div>
        <div v-if="card.style !== 'frosted'" class="glass-specular"></div>
        <div class="glass-content">
          <!-- CHANGED (#5): removed low-res blurred layer, single clean image -->
          <!-- CHANGED (#2): imgOffsetX / imgOffsetY / imgScale let you frame each image manually -->
          <img v-if="card.image"
               :src="card.image"
               alt="Card image"
               class="card-image full-res"
               draggable="false"
               @load="onImageLoad(index)"
               :class="{ 'loaded': imageLoaded[index] }"
               :style="{
                 transform: `translate(${card.imgOffsetX || 0}px, ${card.imgOffsetY || 0}px) scale(${card.imgScale || 1.05})`,
                 filter: 'brightness(1.05) saturate(1.1)'
               }"/>
          <span v-else class="placeholder-icon">🖼️</span>
          <span class="placeholder-text">{{ card.image ? '' : 'Replace with your image' }}</span>
        </div>
      </div>
    </div>

    <!-- CHANGED (#3): everything below hero is hidden until intro animation finishes -->
    <div class="below-fold" :class="{ 'below-visible': settled }">
      <!-- PRIMARY CTAs -->
      <div class="cta-section" :class="{ 'cta-visible': settled }">
        <div class="cta-row">
          <div class="btn-wrap" @click="goTo('products')">
            <button class="glass-btn primary-cta"><span>🛍️ Shop Now</span></button>
          </div>
          <div class="btn-wrap secondary-wrap" @click="togglePopup">
            <button class="glass-btn secondary-cta"><span>✨ Explore</span></button>
          </div>
        </div>
      </div>

      <!-- WHY PAHAD S (Benefits) -->
      <section class="benefits-section">
        <p class="section-eyebrow">Why PahadS</p>
        <div class="benefits-grid">
          <div class="benefit-item">
            <div class="benefit-icon">🌿</div>
            <h4>100% Pure</h4>
            <p>No additives, no preservatives — just pure Himalayan goodness</p>
          </div>
          <div class="benefit-item">
            <div class="benefit-icon">🪵</div>
            <h4>Bilona Method</h4>
            <p>Traditionally hand-churned in small batches the old way</p>
          </div>
          <div class="benefit-item">
            <div class="benefit-icon">🐄</div>
            <h4>A2 Desi Cows</h4>
            <p>From desi cows grazing high in the mountains</p>
          </div>
          <div class="benefit-item">
            <div class="benefit-icon">🏔️</div>
            <h4>From the Hills</h4>
            <p>Sourced directly from families across Himachal</p>
          </div>
        </div>
      </section>

      <!-- UPDATES SLIDER (keeps floating cards above, shows 2–3 rotating stories) -->
      <section class="updates-section">
        <p class="section-eyebrow">From the hills</p>
        <h2 class="section-heading">What’s new</h2>
        <div class="updates-slider">
          <div class="updates-track" :style="{ transform: `translateX(-${slideIndex * 100}%)` }">
            <div v-for="(slide, i) in updateSlides" :key="i" class="update-slide">
              <div class="update-image-wrap">
                <img :src="slide.image" :alt="slide.title" class="update-image" loading="lazy"/>
              </div>
              <div class="update-copy">
                <span class="update-tag">{{ slide.tag }}</span>
                <h3 class="update-title">{{ slide.title }}</h3>
                <p class="update-text">{{ slide.text }}</p>
              </div>
            </div>
          </div>
          <div class="updates-nav">
            <button class="updates-dot" v-for="(_, i) in updateSlides" :key="'dot-'+i"
                    :class="{ active: slideIndex === i }"
                    @click="goToSlide(i)" aria-label="Go to slide"></button>
          </div>
          <button class="updates-arrow prev" @click="prevSlide" aria-label="Previous">‹</button>
          <button class="updates-arrow next" @click="nextSlide" aria-label="Next">›</button>
        </div>
      </section>

      <!-- STORY SECTION -->
      <section class="story-section">
        <p class="section-eyebrow">{{ story.eyebrow }}</p>
        <h2 class="story-heading" v-html="story.heading"></h2>
        <p class="section-body" v-html="story.body"></p>
      </section>

      <!-- PRODUCTS -->
      <section class="products-section">
        <p class="section-eyebrow">From the shop</p>
        <h2 class="section-heading">What people are loving</h2>
        <div v-if="productsLoading" class="preview-loading">Loading…</div>
        <div v-else-if="previewProducts.length === 0" class="preview-empty">Coming soon.</div>
        <!-- CHANGED (#1): 3 cols desktop/tablet, 2 cols mobile -->
        <div v-else class="products-row">
          <div v-for="p in previewProducts" :key="p.id" class="product-item" @click="goToProduct(p)">
            <!-- CHANGED (#6): contain so edges aren't cut -->
            <img v-if="primaryImage(p)" :src="primaryImage(p)" :alt="p.name" class="product-img" loading="lazy"/>
            <div v-else class="product-emoji">{{ p.emoji || '🌾' }}</div>
            <h4 class="product-name">{{ p.name }}</h4>
            <span class="product-price">₹{{ displayPrice(p) }}</span>
          </div>
        </div>
        <button class="see-all" @click="router.push('/products')">See all →</button>
      </section>

      <!-- SOCIAL -->
      <section class="social-section">
        <p class="section-eyebrow">Follow the journey</p>
        <div class="social-links">
          <a v-for="s in socialLinks" :key="s.label" :href="s.href" class="social-link" target="_blank" rel="noopener">{{ s.emoji }} {{ s.label }}</a>
        </div>
      </section>
    </div>

    <!-- POPUP -->
    <div v-if="showPopup" class="popup-overlay" @click="closePopup">
      <div class="popup-box" @click.stop>
        <button class="popup-btn green" @click="goTo('products')"><span>🛍️ Products</span></button>
        <button class="popup-btn orange" @click="goTo('trekking')"><span>🥾 Trekking</span></button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchActiveProducts, fetchLandingConfig } from './db.js'

const router = useRouter()
const showPopup = ref(false)
const togglePopup = () => { showPopup.value = !showPopup.value }
const closePopup = () => { showPopup.value = false }
const goTo = (route) => { showPopup.value = false; router.push(`/${route}`) }

// ─── UPDATES SLIDER ───
const slideIndex = ref(0)
let slideTimer = null
const updateSlides = ref([
  {
    tag: 'New drop',
    title: 'Fresh from the high pastures',
    text: 'Our latest small-batch produce is on its way from the hills — pure, seasonal, and made the traditional way.',
    image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80'
  },
  {
    tag: 'In the mountains',
    title: 'Life above the clouds',
    text: 'Meet the families and landscapes behind every jar. Real places, real hands, real flavour.',
    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80'
  },
  {
    tag: 'Kitchen stories',
    title: 'How the hills taste at home',
    text: 'From morning chai to slow-cooked meals — simple ways our community uses what comes from the pahad.',
    image: 'https://images.unsplash.com/photo-1478144592103-25e218a04891?w=1200&q=80'
  }
])
const goToSlide = (i) => { slideIndex.value = i; restartSlideTimer() }
const nextSlide = () => { slideIndex.value = (slideIndex.value + 1) % updateSlides.value.length; restartSlideTimer() }
const prevSlide = () => { slideIndex.value = (slideIndex.value - 1 + updateSlides.value.length) % updateSlides.value.length; restartSlideTimer() }
const restartSlideTimer = () => {
  if (slideTimer) clearInterval(slideTimer)
  slideTimer = setInterval(() => {
    slideIndex.value = (slideIndex.value + 1) % updateSlides.value.length
  }, 5500)
}

const settled = ref(false)
const loadedCards = ref([false, false, false, false, false])
const imageLoaded = ref([false, false, false, false, false])
const screenWidth = ref(window.innerWidth)
const landingConfig = ref(null)
const configLoading = ref(true)

// ─── DEFAULT CONFIG (fallback) ───
const defaultConfig = {
  cards: [
    { id: 'c1', style: 'distort', size: 'lg', label: '', rotate: -6, image: '', imgOffsetX: 0, imgOffsetY: 0, imgScale: 1.05, initialZ: 3 },
    { id: 'c2', style: 'distort', size: 'sm', label: '', rotate: 4, image: '', imgOffsetX: 0, imgOffsetY: 0, imgScale: 1.1, initialZ: 2 },
    { id: 'c3', style: 'specular', size: 'md', label: '', rotate: -3, image: '', imgOffsetX: 0, imgOffsetY: 0, imgScale: 1.1, initialZ: 5 },
    { id: 'c4', style: 'specular', size: 'sm', label: '', rotate: 7, image: '', imgOffsetX: 0, imgOffsetY: 0, imgScale: 1.1, initialZ: 4 },
    { id: 'c5', style: 'frosted', size: 'md', label: '', rotate: -8, image: '', imgOffsetX: 0, imgOffsetY: 0, imgScale: 1.1, initialZ: 1 },
  ],
  scatteredImages: {
    desktop: [
      { src: '/images/image1.avif', x: 45, y: 7, width: 16, rotation: -70 },
      { src: '/images/image2.avif', x: 21.5, y: 80.5, width: 10, rotation: 390 },
      { src: '/images/image3.avif', x: 33, y: 106, width: 6, rotation: -245 },
      { src: '/images/image4.avif', x: 73.43666702411234, y: 200.4175654853623, width: 26.5, rotation: 0 },
      { src: '/images/image7.avif', x: 69.49982255379554, y: -0.22958397534668679, width: 34, rotation: 0 },
      { src: '/images/image8.avif', x: 74, y: 102, width: 31, rotation: -5 },
      { src: '/images/image9.avif', x: 0.2440944881889768, y: 0.6070878274268605, width: 23.6, rotation: 0 },
      { src: '/images/image11.avif', x: -2.5, y: 106, width: 47, rotation: 190 },
      { src: '/images/image12.avif', x: 20.252918287937735, y: 8.534668721109398, width: 16.5, rotation: 30 }
    ],
    tablet: [
      { src: '/images/image1.avif', x: 42.29268292682925, y: 10.08782742681048, width: 26, rotation: -45 },
      { src: '/images/image2.avif', x: 67.5, y: 93, width: 15.5, rotation: 275 },
      { src: '/images/image3.avif', x: 4.5, y: 79.5, width: 9, rotation: -245 },
      { src: '/images/image4.avif', x: 66.67080745341613, y: 218.37442218798145, width: 33, rotation: 0 },
      { src: '/images/image7.avif', x: 66.53658536585358, y: 0.5408320493066252, width: 33.5, rotation: 0 },
      { src: '/images/image8.avif', x: 62.5, y: 109.5, width: 44.5, rotation: 0 },
      { src: '/images/image9.avif', x: 0.2317073170731706, y: 0.46224961479198773, width: 27.5, rotation: 0 },
      { src: '/images/image11.avif', x: 0, y: 104, width: 59, rotation: 180 },
      { src: '/images/image12.avif', x: -2.980487804878048, y: 150, width: 20, rotation: 10 }
    ],
    mobile: [
      { src: '/images/image1.avif', x: 52.264102564102544, y: 6.019414483821265, width: 32, rotation: -50 },
      { src: '/images/image2.avif', x: 2.5, y: 120, width: 20.5, rotation: 75 },
      { src: '/images/image3.avif', x: 16.88461538461537, y: -1.6571648690292755, width: 12.5, rotation: -245 },
      { src: '/images/image4.avif', x: 45.5, y: 115, width: 54, rotation: 360 },
      { src: '/images/image7.avif', x: 61.12820512820514, y: 0.17041602465331301, width: 40, rotation: 0 },
      { src: '/images/image8.avif', x: 51.5, y: 52, width: 56.5, rotation: 0 },
      { src: '/images/image9.avif', x: -8.430769230769226, y: 0.15408320493066296, width: 44.5, rotation: 0 },
      { src: '/images/image11.avif', x: -4, y: 45, width: 65, rotation: 550 },
      { src: '/images/image12.avif', x: 14.902564102564089, y: 8.44684129429891, width: 31.5, rotation: 15 }
    ]
  },
  hero: {
    title: 'Pahad',
    subtitle: 'S',
    tagline: 'From the Himalayas with love 🌿'
  },
  story: {
    eyebrow: 'Our Story',
    heading: 'Straight from the <span class="accent">Pahad</span>,<br>to your kitchen table',
    body: "We're a small team sourcing genuinely traditional Himalayan produce — the way our grandparents made it, not the way a factory does. Everything we sell is made in small batches by families across Himachal, with nothing added and nothing cut out."
  },
  socialLinks: [
    { label: 'Instagram', emoji: '📷', href: '#' },
    { label: 'Facebook', emoji: '📘', href: '#' },
    { label: 'YouTube', emoji: '▶️', href: '#' }
  ]
}

// ─── COMPUTED: Merge config with defaults ───
const cards = computed(() => {
  const base = landingConfig.value?.cards || defaultConfig.cards
  return base.map((card, i) => ({
    ...defaultConfig.cards[i],
    ...card
  }))
})

const scatteredByBreakpoint = computed(() => {
  return landingConfig.value?.scatteredImages || defaultConfig.scatteredImages
})

const hero = computed(() => ({ ...defaultConfig.hero, ...(landingConfig.value?.hero || {}) }))
const story = computed(() => ({ ...defaultConfig.story, ...(landingConfig.value?.story || {}) }))
const socialLinks = computed(() => landingConfig.value?.socialLinks || defaultConfig.socialLinks)

const getBreakpoint = (w) => (w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop')
const currentScattered = computed(() => scatteredByBreakpoint.value[getBreakpoint(screenWidth.value)] || [])

const onImageLoad = (index) => { imageLoaded.value[index] = true; loadedCards.value[index] = true }
const preloadImages = () => {
  const imageUrls = cards.value.map(c => c.image).filter(Boolean)
  let loaded = 0
  imageUrls.forEach(url => {
    const img = new Image()
    img.onload = () => { loaded++ }
    img.onerror = () => { loaded++ }
    img.src = url
  })
}

// Load landing config on mount
async function loadLandingConfig() {
  try {
    const config = await fetchLandingConfig()
    landingConfig.value = config
  } catch (e) {
    console.error('Failed to load landing config:', e)
  } finally {
    configLoading.value = false
    preloadImages()
  }
}

// ─── CARD POSITIONS ───
const getPosition = (index) => {
  const w = screenWidth.value
  const isMobile = w < 480
  const isTablet = w < 768
  const positions = [{ x: -310, y: -10 }, { x: -90, y: 0 }, { x: 330, y: -40 }, { x: 100, y: 5 }, { x: 325, y: 150 }]
  let scale = 1
  if (isMobile) scale = 0.35
  else if (isTablet) scale = 0.55
  return { x: positions[index].x * scale, y: positions[index].y * scale }
}

const positions = reactive({
  c1: { x: getPosition(0).x, y: getPosition(0).y },
  c2: { x: getPosition(1).x, y: getPosition(1).y },
  c3: { x: getPosition(2).x, y: getPosition(2).y },
  c4: { x: getPosition(3).x, y: getPosition(3).y },
  c5: { x: getPosition(4).x, y: getPosition(4).y }
})
const draggedCards = reactive({ c1: false, c2: false, c3: false, c4: false, c5: false })
const updatePositions = () => {
  const prev = getBreakpoint(screenWidth.value)
  screenWidth.value = window.innerWidth
  if (getBreakpoint(screenWidth.value) === prev) return
  const keys = ['c1','c2','c3','c4','c5']
  keys.forEach((key, i) => {
    if (draggedCards[key]) return
    const pos = getPosition(i)
    positions[key].x = pos.x
    positions[key].y = pos.y
  })
}

// zCounter starts at 100 so cards always sit above text sections (which are z:1)
// initialZ is applied from card config on mount
let zCounter = 100
const zIndexMap = ref({
  c1: 103,
  c2: 102,
  c3: 105,
  c4: 104,
  c5: 101
})

// Initialize zIndexMap from cards config when cards are available
watch(cards, (newCards) => {
  if (newCards && newCards.length === 5) {
    zIndexMap.value = {
      c1: (newCards[0]?.initialZ || 3) + 100,
      c2: (newCards[1]?.initialZ || 2) + 100,
      c3: (newCards[2]?.initialZ || 5) + 100,
      c4: (newCards[3]?.initialZ || 4) + 100,
      c5: (newCards[4]?.initialZ || 1) + 100
    }
  }
}, { immediate: true, deep: true })

const dragState = ref({ active: false, id: null, startX: 0, startY: 0, origX: 0, origY: 0 })
function bringToFront(id) { zCounter += 1; zIndexMap.value[id] = zCounter }
function startDrag(e, id) {
  e.preventDefault(); bringToFront(id); draggedCards[id] = true
  dragState.value = { active: true, id, startX: e.clientX, startY: e.clientY, origX: positions[id].x, origY: positions[id].y }
}
function onMouseMove(e) {
  if (!dragState.value.active) return
  const { id, startX, startY, origX, origY } = dragState.value
  positions[id].x = origX + (e.clientX - startX)
  positions[id].y = origY + (e.clientY - startY)
}
function onMouseUp() { dragState.value.active = false }
function startDragTouch(e, id) {
  e.preventDefault(); bringToFront(id); draggedCards[id] = true
  const touch = e.touches[0]
  dragState.value = { active: true, id, startX: touch.clientX, startY: touch.clientY, origX: positions[id].x, origY: positions[id].y }
}
function onTouchMove(e) {
  if (!dragState.value.active) return
  e.preventDefault()
  const touch = e.touches[0]
  const { id, startX, startY, origX, origY } = dragState.value
  positions[id].x = origX + (touch.clientX - startX)
  positions[id].y = origY + (touch.clientY - startY)
}
function onTouchEnd() { dragState.value.active = false }

// ─── PRODUCTS ───
const allProducts = ref([])
const productsLoading = ref(true)
// CHANGED: preview count is breakpoint-aware — 2 on mobile, 3 on tablet/desktop
const previewProducts = computed(() => {
  const count = getBreakpoint(screenWidth.value) === 'mobile' ? 2 : 3
  return allProducts.value.slice(0, count)
})

const generateSlug = (name) => name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') : 'product'
const goToProduct = (product) => router.push(`/product/${generateSlug(product.name)}--${product.id}`)
const hasDiscount = (p) => p.discount?.isDiscounted && p.discount?.percent > 0
const getMinBasePrice = (p) => {
  if (p.variants && p.variants.length > 0) return Math.min(...p.variants.map(v => Number(v.price)))
  return p.price || 0
}
const displayPrice = (p) => {
  const minBase = getMinBasePrice(p)
  return hasDiscount(p) ? Math.round(minBase * (1 - p.discount.percent / 100)) : minBase
}
const primaryImage = (p) => p.imageUrls?.find(u => u?.trim()) ?? null

onMounted(async () => {
  // Load landing config
  await loadLandingConfig()

  // Load products
  try { productsLoading.value = true; allProducts.value = await fetchActiveProducts() } catch (e) { console.error(e) } finally { productsLoading.value = false }

  preloadImages()
  window.addEventListener('resize', updatePositions)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd)

  setTimeout(async () => {
    await nextTick()
    requestAnimationFrame(() => {
      settled.value = true
      const leafContainer = document.querySelector('.bg-scattered')
      if (leafContainer) leafContainer.classList.add('loaded')
      restartSlideTimer()
    })
    cards.value.forEach((_, i) => {
      setTimeout(() => { loadedCards.value[i] = true }, 4700 + i * 200)
    })
  }, 4500)
})

onUnmounted(() => {
  if (slideTimer) clearInterval(slideTimer)
  window.removeEventListener('resize', updatePositions)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
})
</script>

<style scoped>
/* ─── VARIABLES ─── */
.page {
  --glass-bg: rgba(5,54,8,0.934);
  --glass-blur: 8px;
  --glass-border: rgba(6,45,6,0.931);
  --glass-shadow: 0 4px 24px rgba(46,125,50,0.55);
  --text-color: #fff;
  --overlay-bg: rgba(0,0,0,.35);
  --overlay-blur: 6px;
  --popup-bg: rgba(20,20,20,0.75);
  --popup-blur: 14px;
  --popup-border: rgba(255,255,255,0.12);
  --popup-text: #fff;
  --green: rgba(46,125,50,0.35);
  --green-hover: rgba(46,125,50,0.6);
  --orange: rgba(255,152,0,0.35);
  --orange-hover: rgba(255,152,0,0.6);
  --anim-speed: .25s;
  --hover-scale: 1.04;
  --lg-bg: rgba(255,255,255,0.12);   /* CHANGED (#5): much lighter overlay */
  --lg-highlight: rgba(255,255,255,0.9);
  --lg-border: rgba(255,255,255,0.6);
  --premium-green: #2E7D32;
  position: relative;
  min-height: 100vh;
  background: linear-gradient(135deg, #0F2A1F, #2A5C3E);
  padding-bottom: 40px;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  overflow-x: hidden;
}
* { box-sizing: border-box; }
.page-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  background: linear-gradient(135deg, #0F2A1F, #2A5C3E);
  pointer-events: none;
}
.reveal-bg { position: absolute; inset: 0; background: #fdfdfb; opacity: 0; z-index: 0; pointer-events: none; animation: revealBg .8s cubic-bezier(.16,1,.3,1) 4.5s forwards; }
@keyframes revealBg { to { opacity: 1 } }

/* ─── LEAVES ─── */
.bg-scattered { position: absolute; top: 0; left: 0; width: 100%; height: 100vh; z-index: 1; pointer-events: none; overflow: visible; opacity: 0; transition: opacity 0.8s ease; }
.bg-scattered.loaded { opacity: 1; }
.leaf-item { position: absolute; line-height: 0; }
.leaf-item img { width: 100%; display: block; pointer-events: none; user-select: none; -webkit-user-drag: none; }

/* ─── HERO ─── */
.hero-wrapper { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; height: 100vh; max-height: 100vh; padding: 20px; will-change: transform; transition: transform 1.4s cubic-bezier(.16,1,.3,1); transform: translate3d(0,0,0); }
.hero-wrapper.hero-settled { height: auto; max-height: none; min-height: 0; padding-top: 20px; transform: scale3d(.7,.7,1) translate3d(0,0,0); transform-origin: top center; }
.hero { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px; }
.brand { display: flex; font-family: Georgia, serif; font-size: 5rem; font-weight: 700; margin: 0; opacity: 0; flex-wrap: wrap; justify-content: center; animation: fadeIn .5s ease-out forwards; will-change: opacity, color; transition: color 1s cubic-bezier(.16,1,.3,1); }
@keyframes fadeIn { to { opacity: 1 } }
.brand-dark .pahad-dark, .pahad-dark { color: var(--premium-green) !important; }
.brand-dark .s-color-dark, .s-color-dark { color: var(--premium-green) !important; opacity: 1 !important; }
.brand-dark .s-masked-dark, .s-masked-dark { opacity: 0 !important; }
.pahad { color: #F5EDE0; animation: colorPahad 3.6s steps(1,start) .4s forwards; will-change: color; transition: color 1s cubic-bezier(.16,1,.3,1); }
@keyframes colorPahad { 0% { color: #00E5FF } 33% { color: #33FF8C } 66% { color: #FFC640 } 100% { color: #FF3D9A } }
.s-wrap { position: relative; display: inline-grid; }
.s-color, .s-masked { grid-area: 1/1; }
.s-color { color: #F5EDE0; animation: colorS 3.6s steps(1,start) .4s forwards, fadeOutS .3s ease-in 3.2s forwards; will-change: color, opacity; transition: color 1s cubic-bezier(.16,1,.3,1); }
@keyframes colorS { 0% { color: #00E5FF } 33% { color: #33FF8C } 66% { color: #B983FF } 100% { color: #FF6B35 } }
@keyframes fadeOutS { to { opacity: 0 } }
.s-masked { opacity: 0; color: transparent; background-image: url('https://images.unsplash.com/photo-1732535725600-f805d8b33c9c?q=80&w=1470&auto=format&fit=crop'); background-size: 300%; background-position: 100% 50%; background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: fadeInS .5s ease-out 1.8s forwards, maskPan 1s linear 1.8s infinite; will-change: opacity, background-position; transition: opacity 1s cubic-bezier(.16,1,.3,1); }
@keyframes fadeInS { to { opacity: 1 } }
@keyframes maskPan { 0% { background-position: 100% 50% } 100% { background-position: 0% 50% } }
.tagline { font-family: Inter, sans-serif; font-size: 1.1rem; font-weight: 700; color: rgba(245,237,224,.75); margin-top: 16px; letter-spacing: 5px; text-align: center; animation: slideUp .6s ease-out .4s both; will-change: opacity, transform, color; transition: color 1s cubic-bezier(.16,1,.3,1); }
@keyframes slideUp { 0% { opacity: 0; transform: translateY(30px) } 100% { opacity: 1; transform: translateY(0) } }
.tagline-dark { color: rgba(46,125,50,.85) !important; }

.hero-headline {
  font-family: Inter, sans-serif;
  font-size: 1.05rem;
  font-weight: 500;
  color: rgba(245,237,224,.7);
  margin-top: 14px;
  letter-spacing: 1.5px;
  text-align: center;
  max-width: 420px;
  line-height: 1.5;
  opacity: 0;
  animation: slideUp .6s ease-out .7s both;
  transition: color 1s cubic-bezier(.16,1,.3,1);
}
.hero-headline-dark { color: rgba(26,42,26,.7) !important; }

/* ─── CARDS ─── */
/* CHANGED (#4): z-index raised to 50 so cards float above all text sections */
.card-field { position: relative; z-index: 50; width: 100%; min-height: 380px; display: flex; align-items: center; justify-content: center; opacity: 0; transform: translate3d(0,30px,0); transition: opacity 1.2s cubic-bezier(.16,1,.3,1) .1s, transform 1.2s cubic-bezier(.16,1,.3,1) .1s; pointer-events: none; will-change: opacity, transform; padding: 20px 10px; }
.card-field.cards-visible { opacity: 1; transform: translate3d(0,0,0); pointer-events: auto; }
.glass-card { position: absolute; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; border-radius: 1.6rem; overflow: hidden; box-shadow: 0 12px 30px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.06); transition: box-shadow .2s, opacity .5s cubic-bezier(.25,1,.35,1); will-change: transform, opacity; backface-visibility: hidden; -webkit-backface-visibility: hidden; transform: translate3d(0,0,0); opacity: .01; }
.glass-card.card-loaded { opacity: 1; }
.glass-card:active { cursor: grabbing; box-shadow: 0 18px 40px rgba(0,0,0,.18); }
.glass-card.sm { width: 200px; height: 400px; }
.glass-card.md { width: 230px; height: 230px; }
.glass-card.lg { width: 280px; height: 280px; }
.glass-content { position: relative; z-index: 3; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; overflow: hidden; pointer-events: none; }

/* CHANGED (#5): clean, bright image — no blur, no dim layer */
.card-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; transition: opacity .8s cubic-bezier(.25,1,.35,1); }
.full-res { opacity: 0; transition: opacity .8s cubic-bezier(.25,1,.35,1); }
.full-res.loaded { opacity: 1; }

.card-label { position: absolute; top: 10px; left: 12px; z-index: 4; font-family: Inter, sans-serif; font-size: .65rem; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: #1a2a1a; background: rgba(255,255,255,.6); padding: 3px 10px; border-radius: 40px; pointer-events: none; }

/* CHANGED (#5): removed heavy backdrop blur + dark overlay from distort glass */
.glass-filter { position: absolute; inset: 0; z-index: 0; isolation: isolate; }
/* CHANGED (#5): overlay is now very subtle so image stays bright */
.glass-overlay { position: absolute; inset: 0; z-index: 1; background: var(--lg-bg); }
.glass-specular { position: absolute; inset: 0; z-index: 2; border-radius: inherit; box-shadow: inset 1px 1px 0 var(--lg-highlight), inset 0 0 12px rgba(255,255,255,.35); }

.glass-card.frosted { background: rgba(255,255,255,.35); backdrop-filter: blur(10px) saturate(160%); -webkit-backdrop-filter: blur(10px) saturate(160%); border: 1px solid rgba(255,255,255,.5); }
.glass-card.specular { border: 1px solid var(--lg-border); }
.glass-card.distort { border: 1px solid var(--lg-border); }

.placeholder-icon { font-size: 2.2rem; opacity: .5; }
.placeholder-text { font-family: Inter, sans-serif; font-size: .75rem; color: rgba(26,42,26,.5); text-align: center; padding: 0 16px; }
.skeleton { background: rgba(200,200,200,.15); border: 1px solid rgba(200,200,200,.2); pointer-events: none; }
.skeleton-shimmer { position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,.25) 50%, transparent 100%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: 1.6rem; }
@keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }

/* ─── CHANGED (#3): below-fold hidden until hero animation finishes ─── */
.below-fold { opacity: 0; visibility: hidden; transition: opacity 1s cubic-bezier(.16,1,.3,1) .2s, visibility 0s linear 1.2s; }
.below-fold.below-visible { opacity: 1; visibility: visible; transition: opacity 1s cubic-bezier(.16,1,.3,1) .2s, visibility 0s linear 0s; }

/* ─── EXPLORE BUTTON ─── */
.cta-section { position: relative; z-index: 1; display: flex; justify-content: center; align-items: center; padding: 60px 40px 30px; opacity: 0; transform: translateY(30px); transition: opacity 1.2s cubic-bezier(.16,1,.3,1) .15s, transform 1.2s cubic-bezier(.16,1,.3,1) .15s; pointer-events: none; will-change: opacity, transform; }
.cta-section.cta-visible { opacity: 1; transform: translateY(0); pointer-events: auto; }
.cta-row { display: flex; gap: 18px; align-items: center; justify-content: center; flex-wrap: wrap; }
.btn-wrap { cursor: pointer; transition: transform var(--anim-speed) ease; will-change: transform; }
.btn-wrap:hover { transform: scale(var(--hover-scale)); }
.btn-wrap:active { transform: scale(.96); }
.glass-btn { all: unset; cursor: pointer; position: relative; display: flex; align-items: center; justify-content: center; padding: 18px 36px !important; border-radius: 40px; font-family: Inter, sans-serif; font-size: .85rem; font-weight: 600; color: #fff; background: rgba(1,54,2,.885); text-shadow: 0 1px 3px rgba(0,0,0,.15); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(93,217,99,.25); box-shadow: 0 4px 24px rgba(38,151,44,.488), inset 0 1px 0 rgba(255,255,255,.15); transition: all var(--anim-speed) ease; will-change: transform; letter-spacing: .3px; }
.glass-btn:hover { background: rgba(32,200,37,.934); box-shadow: 0 6px 32px rgba(3,33,4,.2), inset 0 1px 0 rgba(255,255,255,.2); border-color: rgba(8,40,10,.891); }
.glass-btn:active { transform: scale(.96); }
.glass-btn span { position: relative; z-index: 1; }
.glass-btn.primary-cta { background: rgba(1,54,2,.92); padding: 18px 40px !important; font-size: .9rem; }
.glass-btn.secondary-cta { background: rgba(255,255,255,.55); color: #1a2a1a; border: 1px solid rgba(46,125,50,.25); box-shadow: 0 4px 18px rgba(0,0,0,.08); text-shadow: none; }
.glass-btn.secondary-cta:hover { background: rgba(255,255,255,.8); border-color: rgba(46,125,50,.4); }

/* ─── BENEFITS ─── */
.benefits-section { position: relative; z-index: 1; max-width: 960px; margin: 0 auto; padding: 30px 32px 40px; text-align: center; }
.benefits-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; margin-top: 28px; }
.benefit-item { background: rgba(46,125,50,.05); border: 1px solid rgba(46,125,50,.12); border-radius: 1.4rem; padding: 28px 18px; transition: transform .25s ease, box-shadow .25s ease; }
.benefit-item:hover { transform: translateY(-4px); box-shadow: 0 12px 28px rgba(46,125,50,.1); }
.benefit-icon { font-size: 1.8rem; margin-bottom: 12px; }
.benefit-item h4 { font-family: Inter, sans-serif; font-size: .95rem; font-weight: 700; color: #1a2a1a; margin: 0 0 8px; }
.benefit-item p { font-family: Inter, sans-serif; font-size: .82rem; line-height: 1.55; color: rgba(26,42,26,.7); margin: 0; }

/* ─── UPDATES SLIDER ─── */
.updates-section { position: relative; z-index: 1; max-width: 920px; margin: 0 auto; padding: 20px 24px 50px; text-align: center; }
.updates-slider { position: relative; margin-top: 28px; border-radius: 1.6rem; overflow: hidden; background: rgba(46,125,50,.04); border: 1px solid rgba(46,125,50,.12); box-shadow: 0 12px 40px rgba(0,0,0,.06); }
.updates-track { display: flex; transition: transform .55s cubic-bezier(.22,1,.36,1); will-change: transform; }
.update-slide { min-width: 100%; display: grid; grid-template-columns: 1.15fr 1fr; align-items: stretch; }
.update-image-wrap { position: relative; min-height: 280px; overflow: hidden; }
.update-image { width: 100%; height: 100%; object-fit: cover; display: block; }
.update-copy { display: flex; flex-direction: column; justify-content: center; text-align: left; padding: 36px 32px; background: rgba(255,255,255,.72); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.update-tag { display: inline-block; align-self: flex-start; font-family: Inter, sans-serif; font-size: .7rem; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--premium-green, #2e7d32); background: rgba(46,125,50,.1); padding: 5px 12px; border-radius: 40px; margin-bottom: 14px; }
.update-title { font-family: Georgia, serif; font-size: 1.55rem; font-weight: 700; color: #1a2a1a; margin: 0 0 12px; line-height: 1.3; }
.update-text { font-family: Inter, sans-serif; font-size: .95rem; line-height: 1.65; color: rgba(26,42,26,.72); margin: 0; }
.updates-nav { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; z-index: 5; }
.updates-dot { width: 8px; height: 8px; border-radius: 50%; border: none; padding: 0; cursor: pointer; background: rgba(26,42,26,.25); transition: background .2s, transform .2s; }
.updates-dot.active { background: var(--premium-green, #2e7d32); transform: scale(1.25); }
.updates-arrow { position: absolute; top: 50%; transform: translateY(-50%); z-index: 5; width: 40px; height: 40px; border-radius: 50%; border: none; background: rgba(255,255,255,.85); color: #1a2a1a; font-size: 1.5rem; line-height: 1; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.1); transition: background .2s, transform .2s; display: flex; align-items: center; justify-content: center; }
.updates-arrow:hover { background: #fff; transform: translateY(-50%) scale(1.06); }
.updates-arrow.prev { left: 12px; }
.updates-arrow.next { right: 12px; }

/* ─── STORY ─── */
.story-section { position: relative; z-index: 1; max-width: 800px; margin: 0 auto; padding: 60px 32px; text-align: center; }
.section-eyebrow { font-family: Inter, sans-serif; font-size: .75rem; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: var(--premium-green); margin: 0 0 12px; }
.story-heading { font-family: Georgia, serif; font-size: 2.8rem; font-weight: 700; line-height: 1.3; color: #1a2a1a; margin: 0 0 20px; }
.story-heading .accent { color: var(--premium-green); }
.section-body { font-family: Inter, sans-serif; font-size: 1.05rem; line-height: 1.8; color: rgba(26,42,26,.75); max-width: 640px; margin: 0 auto; }

/* ─── PRODUCTS ─── */
.products-section { position: relative; z-index: 1; max-width: 900px; margin: 0 auto; padding: 40px 32px 60px; text-align: center; }
.section-heading { font-family: Georgia, serif; font-size: 2rem; font-weight: 700; color: #1a2a1a; margin: 0 0 24px; }
/* CHANGED (#1): 3 columns by default (desktop + tablet) */
.products-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; margin-top: 32px; justify-items: center; justify-content: center; }
.product-item { width: 180px; cursor: pointer; text-align: left; }
/* CHANGED (#6): contain so edges aren't cut, with a soft background */
.product-img { width: 180px; height: 180px; object-fit: contain; border-radius: 1.2rem; display: block; margin-bottom: 12px; transition: transform .3s ease; background: rgba(46,125,50,.06); padding: 6px; }
.product-item:hover .product-img { transform: scale(1.03); }
.product-emoji { width: 180px; height: 180px; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; background: rgba(46,125,50,.08); border-radius: 1.2rem; margin-bottom: 12px; }
.product-name { font-family: Inter, sans-serif; font-size: .95rem; font-weight: 600; color: #1a2a1a; margin: 0 0 4px; }
.product-price { font-family: Inter, sans-serif; font-size: .9rem; font-weight: 600; color: var(--premium-green); }
.preview-loading, .preview-empty { font-family: Inter, sans-serif; color: rgba(26,42,26,.5); margin-top: 32px; }
.see-all { all: unset; cursor: pointer; margin-top: 24px; font-family: Inter, sans-serif; font-size: .9rem; font-weight: 600; color: var(--premium-green); border-bottom: 1px solid transparent; transition: border-color .2s ease; }
.see-all:hover { border-color: var(--premium-green); }

/* ─── SOCIAL ─── */
.social-section { position: relative; z-index: 1; max-width: 500px; margin: 0 auto; padding: 30px 32px 60px; text-align: center; }
.social-links { display: flex; justify-content: center; gap: 28px; margin-top: 16px; flex-wrap: wrap; }
.social-link { font-family: Inter, sans-serif; font-size: .95rem; font-weight: 600; color: #1a2a1a; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color .2s ease, color .2s ease; }
.social-link:hover { color: var(--premium-green); border-color: var(--premium-green); }

/* ─── POPUP ─── */
.popup-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fadeInPopup .3s ease; will-change: opacity; }
@keyframes fadeInPopup { from { opacity: 0; backdrop-filter: blur(0) } to { opacity: 1; backdrop-filter: blur(6px) } }
.popup-box { display: flex; flex-direction: column; gap: 16px; animation: slideUpPopup .35s cubic-bezier(.34,1.56,.64,1); will-change: transform, opacity; }
@keyframes slideUpPopup { from { opacity: 0; transform: translateY(24px) scale(.95) } to { opacity: 1; transform: translateY(0) scale(1) } }
.popup-btn { all: unset; cursor: pointer; position: relative; display: block; padding: 44px 48px; border-radius: 60px; font-family: Inter, sans-serif; font-size: 1.2rem; font-weight: 600; color: #fff; text-align: center; background: rgba(20,20,20,.75); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 8px 32px rgba(0,0,0,.2); transition: all var(--anim-speed) ease; min-width: 200px; will-change: transform; letter-spacing: .3px; }
.popup-btn:hover { transform: scale(var(--hover-scale)); box-shadow: 0 12px 48px rgba(0,0,0,.3); }
.popup-btn:active { transform: scale(.96); }
.popup-btn span { position: relative; z-index: 1; }
.popup-btn.green { background: rgba(46,125,50,.35); border-color: rgba(46,125,50,.25); }
.popup-btn.green:hover { background: rgba(46,125,50,.6); border-color: rgba(46,125,50,.4); box-shadow: 0 8px 40px rgba(46,125,50,.3); }
.popup-btn.orange { background: rgba(255,152,0,.35); border-color: rgba(255,152,0,.25); }
.popup-btn.orange:hover { background: rgba(255,152,0,.6); border-color: rgba(255,152,0,.4); box-shadow: 0 8px 40px rgba(255,152,0,.3); }

/* ─── RESPONSIVE ─── */
@media (max-width: 1024px) {
  .glass-card.lg { width: 220px; height: 220px; }
  .glass-card.md { width: 190px; height: 190px; }
  .glass-card.sm { width: 160px; height: 320px; }
}

/* CHANGED (#3 fix): tablet leaf layer uses a "cover"-style box so it keeps its
   composition intact across common tablet aspect ratios (4:3, 3:2, 16:10, etc.)
   instead of being stretched/displaced by whatever the real viewport ratio is.
   The box is sized to always fully cover the viewport at a fixed 3:4 design
   ratio (like background-size:cover), then centered and cropped by the parent's
   overflow. Leaf %-positions stay correct relative to this fixed-ratio canvas. */
@media (min-width: 768px) and (max-width: 1024px) {
  .bg-scattered {
    top: 50%;
    left: 50%;
    width: max(100vw, 75vh);
    height: max(100vh, 133.334vw);
    transform: translate(-50%, -50%);
  }
}

@media (max-width: 768px) {
  .brand { font-size: 4.2rem; }
  .tagline { font-size: 1.1rem; letter-spacing: 4px; }
  .hero-headline { font-size: .95rem; max-width: 320px; }
  .hero-wrapper.hero-settled { transform: scale3d(.65,.65,1) translate3d(0,0,0); padding-top: 18px; }
  .glass-card.lg { width: 160px; height: 160px; }
  .glass-card.md { width: 135px; height: 135px; }
  .glass-card.sm { width: 120px; height: 240px; }
  .card-field { min-height: 280px; padding: 10px; }
  .cta-section { padding: 30px 20px 20px; }
  .cta-row { gap: 12px; }
  .glass-btn { font-size: .75rem; padding: 14px 26px !important; }
  .glass-btn.primary-cta { padding: 14px 28px !important; }
  .popup-btn { padding: 14px 36px; font-size: 1rem; min-width: 160px; }
  .popup-box { gap: 12px; }
  .story-heading { font-size: 2.2rem; }
  .section-heading { font-size: 1.6rem; }
  .benefits-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .benefit-item { padding: 20px 14px; }
  .update-slide { grid-template-columns: 1fr; }
  .update-image-wrap { min-height: 200px; max-height: 220px; }
  .update-copy { padding: 24px 20px 36px; text-align: center; }
  .update-tag { align-self: center; }
  .update-title { font-size: 1.3rem; }
  .updates-arrow { width: 34px; height: 34px; font-size: 1.25rem; }
  /* CHANGED (#1): 2 columns on mobile, centered as a tight block */
  .products-row { grid-template-columns: repeat(2, 1fr); gap: 24px; max-width: fit-content; margin-left: auto; margin-right: auto; }
  .product-item { width: 140px; }
  .product-img { width: 140px; height: 140px; }
  .product-emoji { width: 140px; height: 140px; }
}
@media (max-width: 480px) {
  .brand { font-size: 3.4rem; }
  .tagline { font-size: 1rem; letter-spacing: 3px; }
  .hero-headline { font-size: .85rem; letter-spacing: 1px; max-width: 280px; }
  .hero-wrapper.hero-settled { transform: scale3d(.55,.55,1) translate3d(0,0,0); padding-top: 16px; }
  .hero { padding: 8px; }
  .glass-card.lg { width: 120px; height: 120px; }
  .glass-card.md { width: 105px; height: 105px; }
  .glass-card.sm { width: 90px; height: 180px; }
  .card-field { min-height: 200px; padding: 5px; }
  .card-label { font-size: .5rem; top: 6px; left: 8px; padding: 2px 8px; }
  .cta-section { padding: 24px 20px 16px; }
  .cta-row { flex-direction: column; gap: 10px; }
  .glass-btn { font-size: .7rem; padding: 14px 28px !important; border-radius: 30px; }
  .popup-btn { padding: 12px 28px; font-size: .9rem; min-width: 140px; }
  .popup-box { gap: 10px; }
  .story-heading { font-size: 1.8rem; }
  .section-body { font-size: .85rem; }
  .benefits-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
  .benefit-item { padding: 16px 12px; }
  .benefit-icon { font-size: 1.5rem; }
  .benefit-item h4 { font-size: .85rem; }
  .benefit-item p { font-size: .75rem; }
  .updates-section { padding: 16px 12px 36px; }
  .update-image-wrap { min-height: 170px; max-height: 180px; }
  .update-copy { padding: 18px 16px 32px; }
  .update-title { font-size: 1.15rem; }
  .update-text { font-size: .85rem; }
  .updates-arrow { display: none; }
  .products-row { grid-template-columns: repeat(2, 1fr); gap: 12px; max-width: fit-content; margin-left: auto; margin-right: auto; }
  .product-item { width: 100%; max-width: 140px; margin: 0 auto; }
  .product-img { width: 120px; height: 120px; margin: 0 auto 10px; }
  .product-emoji { width: 120px; height: 120px; margin: 0 auto 10px; }
  .product-name { font-size: .85rem; text-align: center; }
  .product-price { text-align: center; display: block; }
  .social-links { gap: 16px; }
  .social-link { font-size: .8rem; }
}
@media (max-width: 380px) {
  .brand { font-size: 2.8rem; }
  .tagline { font-size: .85rem; letter-spacing: 2.5px; }
  .hero-wrapper.hero-settled { transform: scale3d(.5,.5,1) translate3d(0,0,0); padding-top: 14px; }
  .glass-card.lg { width: 95px; height: 95px; }
  .glass-card.md { width: 85px; height: 85px; }
  .glass-card.sm { width: 75px; height: 150px; }
  .card-field { min-height: 160px; }
  .cta-section { padding: 16px 16px 12px; }
  .glass-btn { height: 28px; font-size: .6rem; padding: 4px 6px; border-radius: 24px; }
  .popup-btn { padding: 10px 20px; font-size: .8rem; min-width: 120px; }
  .products-row { grid-template-columns: repeat(2, 1fr); gap: 8px; max-width: fit-content; margin-left: auto; margin-right: auto; }
  .product-item { max-width: 110px; }
  .product-img { width: 100px; height: 100px; }
  .product-emoji { width: 100px; height: 100px; }
}
@media (max-width: 768px) {
  .glass-card { cursor: default; }
  .glass-card:active { transform: scale(1.02); }
}
</style>