<script setup>
import { ref, computed, onMounted } from 'vue'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import imageCompression from 'browser-image-compression'
// ✅ From src/components/admin/YourFile.vue
import { db, storage} from '../db.js'
import {
  fetchLandingConfig,
  saveLandingConfig,
  fetchAboutConfig,
  saveAboutConfig
} from '../db.js'

const props = defineProps({ userRole: { type: String, default: 'user' } })

const loading = ref(true)
const activePage = ref('landing')
const activeSection = ref('cards')

// Config States
const configs = ref({ landing: null, about: null })
const originalConfigs = ref({ landing: null, about: null })
const authConfig = ref({ loginBg: '', registerBg: '' })
const originalAuthConfig = ref({ loginBg: '', registerBg: '' })

// Editor States
const editingCardId = ref(null)
const editingSectionId = ref(null) // For About/Auth lazy loading
const cardForm = ref({})

// Upload States
const uploadProgress = ref(false)
const uploadError = ref('')
const useCompression = ref(true) // OPTIONAL COMPRESSION TOGGLE

const isSuperAdmin = computed(() => props.userRole === 'superadmin')

const sizeOptions = [
  { value: 'sm', label: 'Small (200×400)' },
  { value: 'md', label: 'Medium (230×230)' },
  { value: 'lg', label: 'Large (280×280)' }
]
const styleOptions = [
  { value: 'distort', label: 'Liquid Distort' },
  { value: 'specular', label: 'Specular Glass' },
  { value: 'frosted', label: 'Simple Frosted' }
]

const pages = [
  { id: 'landing', label: 'Landing', icon: '🏠', sections: [
    { id: 'cards', label: 'Cards (Glass UI)', icon: '🃏' },
    { id: 'hero', label: 'Hero Text', icon: '🦸' },
    { id: 'story', label: 'Story', icon: '📖' },
  ]},
  { id: 'about', label: 'About Page', icon: '🏔️', sections: [
    { id: 'images', label: 'Page Images', icon: '🖼️' },
    { id: 'text', label: 'Text Content', icon: '📝' }
  ]},
  { id: 'auth', label: 'Login & Register', icon: '🔐', sections: [
    { id: 'backgrounds', label: 'Background Images', icon: '🎨' }
  ]}
]

const currentSections = computed(() => pages.find(p => p.id === activePage.value)?.sections || [])

// ─── INITIALIZATION ───
onMounted(async () => {
  loading.value = true
  try {
    // Load Landing
    try {
      const lData = await fetchLandingConfig()
      configs.value.landing = JSON.parse(JSON.stringify(lData))
      originalConfigs.value.landing = JSON.parse(JSON.stringify(lData))
    } catch (e) {
      console.error('fetchLandingConfig error:', e)
      configs.value.landing = { hero: { title: 'PahadS', subtitle: 'P', tagline: 'Mountain Store' }, cards: [], story: { heading: 'Our Story', body: '' } }
      originalConfigs.value.landing = { hero: { title: 'PahadS', subtitle: 'P', tagline: 'Mountain Store' }, cards: [], story: { heading: 'Our Story', body: '' } }
    }
    
    // Load About
    try {
      const aData = await fetchAboutConfig()
      configs.value.about = JSON.parse(JSON.stringify(aData))
      originalConfigs.value.about = JSON.parse(JSON.stringify(aData))
    } catch (e) {
      console.error('Fetch About Config Error:', e)
      configs.value.about = { images: {}, text: { heroTitle: 'About Us', section1Body: '', section2Body: '', founderQuote: '' } }
      originalConfigs.value.about = { images: {}, text: { heroTitle: 'About Us', section1Body: '', section2Body: '', founderQuote: '' } }
    }

    // Load Auth Backgrounds
    try {
      const authSnap = await getDoc(doc(db, 'systemConfig', 'authPages'))
      if (authSnap.exists()) {
        authConfig.value = authSnap.data()
        originalAuthConfig.value = JSON.parse(JSON.stringify(authSnap.data()))
      }
    } catch (e) {
      console.warn('Auth config read failed (non-critical):', e.message)
    }
  } catch (e) {
    console.error('Failed to load configs:', e)
  } finally {
    loading.value = false
  }
})

function switchPage(pageId) {
  activePage.value = pageId
  activeSection.value = pages.find(p => p.id === pageId).sections[0].id
  editingCardId.value = null
  editingSectionId.value = null
}

const hasChanges = computed(() => {
  if (activePage.value === 'auth') return JSON.stringify(authConfig.value) !== JSON.stringify(originalAuthConfig.value)
  const cfg = configs.value[activePage.value]
  const orig = originalConfigs.value[activePage.value]
  if (!cfg || !orig) return false
  return JSON.stringify(cfg) !== JSON.stringify(orig)
})

// ─── LAZY EDITOR CONTROLS ───
function editCard(card) {
  if (editingCardId.value === card.id) {
    editingCardId.value = null
  } else {
    editingCardId.value = card.id
    cardForm.value = { ...card }
  }
}

function saveCard() {
  const idx = configs.value.landing.cards.findIndex(c => c.id === editingCardId.value)
  if (idx >= 0) configs.value.landing.cards[idx] = { ...cardForm.value }
  editingCardId.value = null
}

function toggleEditSection(sectionId) {
  editingSectionId.value = editingSectionId.value === sectionId ? null : sectionId
}

// ─── CUSTOM UPLOAD LOGIC (With Optional Compression) ───
async function handleCustomUpload(file, pathPrefix) {
  if (!file || !file.type.startsWith('image/')) {
    uploadError.value = 'Please select a valid image file.'
    return null
  }
  
  uploadProgress.value = true
  uploadError.value = ''
  let fileToUpload = file

  try {
    // Compress only if toggled ON and file > 300KB
    if (useCompression.value && file.size > 300000) {
      fileToUpload = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true })
    }

    const ext = file.name.split('.').pop()
    const filePath = `website_assets/${pathPrefix}/${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`
    const sRef = storageRef(storage, filePath)
    
    await uploadBytes(sRef, fileToUpload)
    const url = await getDownloadURL(sRef)
    return url
  } catch (e) {
    uploadError.value = 'Upload failed: ' + e.message
    return null
  } finally {
    uploadProgress.value = false
  }
}

async function removeImageFromStorage(url) {
  if (!url || !url.includes('firebasestorage.googleapis.com')) return
  try { await deleteObject(storageRef(storage, url)) } catch (e) { console.warn('Deletion skipped:', e.message) }
}

// Upload Handlers
async function uploadCardImage(cardId, event) {
  const file = event.target.files[0]
  if (!file) return
  const url = await handleCustomUpload(file, `landing_cards`)
  if (url) cardForm.value.image = url
  event.target.value = ''
}

async function uploadAboutImageCustom(key, event) {
  const file = event.target.files[0]
  if (!file) return
  const url = await handleCustomUpload(file, `about_page`)
  if (url) configs.value.about.images[key] = url
  event.target.value = ''
}

async function uploadAuthImage(key, event) {
  const file = event.target.files[0]
  if (!file) return
  const url = await handleCustomUpload(file, `auth_pages`)
  if (url) authConfig.value[key] = url
  event.target.value = ''
}

// Delete Handlers
async function deleteCardImage() {
  await removeImageFromStorage(cardForm.value.image)
  cardForm.value.image = ''
}
async function deleteAboutImageCustom(key) {
  await removeImageFromStorage(configs.value.about.images[key])
  configs.value.about.images[key] = ''
}
async function deleteAuthImage(key) {
  await removeImageFromStorage(authConfig.value[key])
  authConfig.value[key] = ''
}

// ─── SAVE ALL ───
async function saveAll() {
  if (!isSuperAdmin.value) { alert('❌ Only SuperAdmins can save configuration'); return }
  
  try {
    if (activePage.value === 'landing') {
      await saveLandingConfig(configs.value.landing)
      originalConfigs.value.landing = JSON.parse(JSON.stringify(configs.value.landing))
    } else if (activePage.value === 'about') {
      await saveAboutConfig(configs.value.about)
      originalConfigs.value.about = JSON.parse(JSON.stringify(configs.value.about))
    } else if (activePage.value === 'auth') {
      await setDoc(doc(db, 'systemConfig', 'authPages'), { ...authConfig.value, updatedAt: serverTimestamp() }, { merge: true })
      originalAuthConfig.value = JSON.parse(JSON.stringify(authConfig.value))
    }
    alert('✅ Configuration saved successfully!')
  } catch (e) {
    alert('❌ Error saving: ' + e.message)
  }
}

function discardChanges() {
  if (activePage.value === 'auth') {
    authConfig.value = JSON.parse(JSON.stringify(originalAuthConfig.value))
  } else {
    configs.value[activePage.value] = JSON.parse(JSON.stringify(originalConfigs.value[activePage.value]))
  }
  editingCardId.value = null
  editingSectionId.value = null
}
</script>

<template>
  <div class="content-manager-workspace">
    <!-- Header -->
    <div class="ws-head">
      <div>
        <h2 class="ws-title">Content Manager</h2>
        <p class="ws-subtitle">Edit text and images globally without touching code.</p>
      </div>
      <div class="ws-actions">
        <button v-if="hasChanges && isSuperAdmin" class="btn-primary" @click="saveAll" :disabled="loading">💾 Save Changes</button>
        <button v-if="hasChanges" class="btn-outline" @click="discardChanges">↩️ Discard</button>
      </div>
    </div>

    <!-- Page Navigator -->
    <div class="page-selector" v-if="!loading">
      <button v-for="page in pages" :key="page.id" :class="['page-btn', { active: activePage === page.id }]" @click="switchPage(page.id)">
        {{ page.icon }} {{ page.label }}
      </button>
    </div>

    <!-- Section Navigator -->
    <div class="section-nav" v-if="!loading">
      <button v-for="sec in currentSections" :key="sec.id" :class="['section-btn', { active: activeSection === sec.id }]" @click="activeSection = sec.id">
        {{ sec.icon }} {{ sec.label }}
      </button>
    </div>

    <div v-if="loading" class="loading-state"><div class="spinner"></div><p>Loading components...</p></div>

    <div v-else class="editor-viewport fade-in">
      
      <!-- GLOBAL COMPRESSION TOGGLE (Shows when applicable) -->
      <div class="compression-toggle-bar" v-if="activeSection === 'cards' || activeSection === 'images' || activeSection === 'backgrounds'">
        <label class="toggle-switch">
          <input type="checkbox" v-model="useCompression" />
          <span class="slider"></span>
        </label>
        <div class="toggle-info">
          <strong>Compress Images on Upload (Recommended)</strong>
          <span>Turn off only if you need raw, ultra-high resolution (increases website load time).</span>
        </div>
      </div>

      <!-- ─── LANDING PAGE ─── -->
      <template v-if="activePage === 'landing'">
        
        <!-- Cards Lazy Editor -->
        <div v-if="activeSection === 'cards'" class="lazy-list-container">
          <div v-for="card in configs.landing.cards" :key="card.id" class="lazy-accordion-item">
            
            <div class="accordion-header" @click="editCard(card)">
              <div class="acc-info">
                <span class="acc-title">{{ card.label }}</span>
                <span class="acc-meta">Style: {{ card.style }} | Size: {{ card.size }}</span>
              </div>
              <button class="btn-edit-toggle">{{ editingCardId === card.id ? 'Close Editor ✕' : 'Edit Image ✏️' }}</button>
            </div>

            <!-- The Editor (Loads image ONLY when opened) -->
            <div v-if="editingCardId === card.id" class="accordion-body">
              <div class="live-editor-grid">
                
                <!-- Live Preview Window -->
                <div class="preview-panel">
                  <div class="preview-frame-mask" :class="cardForm.size">
                    <img v-if="cardForm.image" :src="cardForm.image" class="live-img" :style="{ transform: `translate(${cardForm.imgOffsetX}px, ${cardForm.imgOffsetY}px) scale(${cardForm.imgScale})` }" />
                    <div v-else class="empty-placeholder">No Image</div>
                  </div>
                </div>

                <!-- Sliders & Controls -->
                <div class="controls-panel">
                  <div class="upload-row">
                    <label class="btn-upload">
                      <input type="file" hidden accept="image/*" @change="uploadCardImage(card.id, $event)" />
                      {{ uploadProgress ? 'Uploading...' : '☁️ Upload New Image' }}
                    </label>
                    <button v-if="cardForm.image" @click="deleteCardImage" class="btn-danger-icon">🗑️</button>
                  </div>

                  <div class="slider-group">
                    <div class="slider-header"><label>🔍 Zoom Scale</label><span>{{ cardForm.imgScale }}x</span></div>
                    <input type="range" v-model.number="cardForm.imgScale" min="0.5" max="3" step="0.01" class="mobile-slider" />
                  </div>
                  
                  <div class="slider-group">
                    <div class="slider-header"><label>↔️ Pan Left/Right</label><span>{{ cardForm.imgOffsetX }}px</span></div>
                    <input type="range" v-model.number="cardForm.imgOffsetX" min="-300" max="300" step="1" class="mobile-slider" />
                  </div>

                  <div class="slider-group">
                    <div class="slider-header"><label>↕️ Pan Up/Down</label><span>{{ cardForm.imgOffsetY }}px</span></div>
                    <input type="range" v-model.number="cardForm.imgOffsetY" min="-300" max="300" step="1" class="mobile-slider" />
                  </div>

                  <div class="basic-configs">
                    <div class="input-col"><label>Label</label><input v-model="cardForm.label" class="clean-input"/></div>
                    <div class="input-col"><label>Size</label><select v-model="cardForm.size" class="clean-input"><option v-for="opt in sizeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></div>
                  </div>

                  <button class="btn-primary w-100 mt-3" @click="saveCard">Apply Changes</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Hero & Story Text -->
        <div v-if="activeSection === 'hero'" class="text-editor-panel">
          <div class="input-col"><label>Brand Name</label><input v-model="configs.landing.hero.title" class="clean-input" /></div>
          <div class="input-col"><label>Accent Letter</label><input v-model="configs.landing.hero.subtitle" class="clean-input" maxlength="1" /></div>
          <div class="input-col"><label>Tagline</label><input v-model="configs.landing.hero.tagline" class="clean-input" /></div>
        </div>

        <div v-if="activeSection === 'story'" class="text-editor-panel">
          <div class="input-col"><label>Heading (HTML allowed)</label><textarea v-model="configs.landing.story.heading" class="clean-input" rows="3"></textarea></div>
          <div class="input-col"><label>Body Text</label><textarea v-model="configs.landing.story.body" class="clean-input" rows="5"></textarea></div>
        </div>
      </template>

      <!-- ─── ABOUT PAGE ─── -->
      <template v-if="activePage === 'about'">
        <div v-if="activeSection === 'images'" class="lazy-list-container">
          <div v-for="(url, key) in configs.about.images" :key="key" class="lazy-accordion-item">
            <div class="accordion-header" @click="toggleEditSection(key)">
              <div class="acc-info"><span class="acc-title">Image Section: {{ key.toUpperCase() }}</span></div>
              <button class="btn-edit-toggle">{{ editingSectionId === key ? 'Close ✕' : 'Edit ✏️' }}</button>
            </div>

            <div v-if="editingSectionId === key" class="accordion-body live-editor-grid">
              <div class="preview-panel">
                <div class="preview-frame-mask landscape"><img v-if="url" :src="url" class="live-img no-transform" /><div v-else class="empty-placeholder">No Image</div></div>
              </div>
              <div class="controls-panel central-controls">
                <label class="btn-upload w-100">
                  <input type="file" hidden accept="image/*" @change="uploadAboutImageCustom(key, $event)" />
                  {{ uploadProgress ? 'Uploading...' : '☁️ Upload New Image' }}
                </label>
                <button v-if="url" @click="deleteAboutImageCustom(key)" class="btn-danger w-100 mt-2">🗑️ Delete Image</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeSection === 'text'" class="text-editor-panel">
          <div class="input-col"><label>Hero Title</label><input v-model="configs.about.text.heroTitle" class="clean-input" /></div>
          <div class="input-col"><label>Section 1 Body</label><textarea v-model="configs.about.text.section1Body" class="clean-input" rows="4"></textarea></div>
          <div class="input-col"><label>Section 2 Body</label><textarea v-model="configs.about.text.section2Body" class="clean-input" rows="4"></textarea></div>
          <div class="input-col"><label>Founder Quote</label><textarea v-model="configs.about.text.founderQuote" class="clean-input" rows="3"></textarea></div>
        </div>
      </template>

      <!-- ─── AUTH PAGES (Login/Register) ─── -->
      <template v-if="activePage === 'auth'">
        <div v-if="activeSection === 'backgrounds'" class="lazy-list-container">
          <div v-for="pageKey in ['loginBg', 'registerBg']" :key="pageKey" class="lazy-accordion-item">
            <div class="accordion-header" @click="toggleEditSection(pageKey)">
              <div class="acc-info"><span class="acc-title">{{ pageKey === 'loginBg' ? 'Login Page Background' : 'Register Page Background' }}</span></div>
              <button class="btn-edit-toggle">{{ editingSectionId === pageKey ? 'Close ✕' : 'Edit ✏️' }}</button>
            </div>

            <div v-if="editingSectionId === pageKey" class="accordion-body live-editor-grid">
              <div class="preview-panel">
                <div class="preview-frame-mask landscape"><img v-if="authConfig[pageKey]" :src="authConfig[pageKey]" class="live-img no-transform" /><div v-else class="empty-placeholder">No Image</div></div>
              </div>
              <div class="controls-panel central-controls">
                <label class="btn-upload w-100">
                  <input type="file" hidden accept="image/*" @change="uploadAuthImage(pageKey, $event)" />
                  {{ uploadProgress ? 'Uploading...' : '☁️ Upload Background' }}
                </label>
                <button v-if="authConfig[pageKey]" @click="deleteAuthImage(pageKey)" class="btn-danger w-100 mt-2">🗑️ Delete Image</button>
              </div>
            </div>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* Base Styles */
.content-manager-workspace { font-family: 'Inter', sans-serif; color: #111827; }
.ws-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
.ws-title { font-size: 24px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.5px;}
.ws-subtitle { color: #6B7280; font-size: 14px; margin: 0; }
.ws-actions { display: flex; gap: 12px; }

/* Buttons */
.btn-primary { background: #111827; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; font-family: inherit;}
.btn-primary:hover { background: #374151; }
.btn-outline { background: #fff; border: 1px solid #E5E7EB; color: #111827; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
.btn-outline:hover { background: #F9FAFB; }
.w-100 { width: 100%; }
.mt-3 { margin-top: 16px; }
.mt-2 { margin-top: 8px; }

/* Navigation */
.page-selector { display: flex; gap: 8px; background: #F9FAFB; padding: 8px; border-radius: 12px; margin-bottom: 16px; overflow-x: auto;}
.page-btn { padding: 10px 16px; background: transparent; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; color: #6B7280; cursor: pointer; white-space: nowrap; transition: 0.2s;}
.page-btn.active { background: #ffffff; color: #111827; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }

.section-nav { display: flex; gap: 16px; margin-bottom: 24px; border-bottom: 1px solid #E5E7EB; overflow-x: auto; }
.section-btn { padding: 0 0 12px; background: transparent; border: none; font-size: 14px; font-weight: 500; color: #6B7280; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap;}
.section-btn.active { color: #111827; font-weight: 600; border-bottom-color: #111827; }

/* Loading */
.loading-state { padding: 60px 0; text-align: center; color: #6B7280; }
.spinner { width: 32px; height: 32px; border: 3px solid #E5E7EB; border-top-color: #111827; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px;}
@keyframes spin { to { transform: rotate(360deg); } }
.fade-in { animation: fadeIn 0.3s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

/* Compression Toggle */
.compression-toggle-bar { display: flex; align-items: center; gap: 16px; background: #F0FDF4; border: 1px solid #BBF7D0; padding: 16px; border-radius: 12px; margin-bottom: 24px; }
.toggle-switch { position: relative; width: 44px; height: 24px; flex-shrink: 0;}
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: .4s; border-radius: 24px; }
.slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
input:checked + .slider { background-color: #10B981; }
input:checked + .slider:before { transform: translateX(20px); }
.toggle-info strong { display: block; font-size: 14px; color: #111827; margin-bottom: 2px;}
.toggle-info span { font-size: 12px; color: #059669; }

/* Lazy Accordion List */
.lazy-list-container { display: flex; flex-direction: column; gap: 16px; }
.lazy-accordion-item { background: #ffffff; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; }
.accordion-header { padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #F9FAFB; transition: 0.2s;}
.accordion-header:hover { background: #F3F4F6; }
.acc-info { display: flex; flex-direction: column; }
.acc-title { font-size: 15px; font-weight: 600; color: #111827; }
.acc-meta { font-size: 12px; color: #6B7280; margin-top: 4px; }
.btn-edit-toggle { background: #ffffff; border: 1px solid #D1D5DB; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }

/* Live Editor Grid */
.accordion-body { padding: 24px; border-top: 1px solid #E5E7EB; }
.live-editor-grid { display: grid; grid-template-columns: 300px 1fr; gap: 32px; align-items: start; }

.preview-panel { background: #F3F4F6; padding: 16px; border-radius: 12px; display: flex; justify-content: center; }
.preview-frame-mask { width: 100%; border-radius: 16px; overflow: hidden; background: #E5E7EB; box-shadow: 0 10px 25px rgba(0,0,0,0.1); position: relative; }
.preview-frame-mask.sm { aspect-ratio: 1/2; max-width: 180px; margin: 0 auto;}
.preview-frame-mask.md { aspect-ratio: 1/1; max-width: 220px; margin: 0 auto;}
.preview-frame-mask.lg { aspect-ratio: 1/1; max-width: 260px; margin: 0 auto;}
.preview-frame-mask.landscape { aspect-ratio: 16/9; max-width: 100%; }

.live-img { width: 100%; height: 100%; object-fit: cover; display: block; transform-origin: center center; }
.no-transform { transform: none !important; }
.empty-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; min-height: 200px; color: #9CA3AF; font-size: 14px; font-weight: 500; }

.controls-panel { display: flex; flex-direction: column; gap: 20px; }
.central-controls { justify-content: center; align-items: center; height: 100%; }
.upload-row { display: flex; gap: 12px; }
.btn-upload { background: #F3F4F6; border: 1px dashed #9CA3AF; color: #111827; padding: 12px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; text-align: center; flex: 1; transition: 0.2s;}
.btn-upload:hover { background: #E5E7EB; border-color: #4B5563; }
.btn-danger-icon { background: #FEE2E2; color: #DC2626; border: none; padding: 0 16px; border-radius: 8px; cursor: pointer; font-size: 16px; }
.btn-danger { background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer;}

/* Touch Sliders */
.slider-group { background: #F9FAFB; padding: 12px 16px; border-radius: 8px; border: 1px solid #E5E7EB; }
.slider-header { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; color: #4B5563; margin-bottom: 12px; }
.slider-header span { color: #111827; background: #ffffff; padding: 2px 6px; border-radius: 4px; border: 1px solid #E5E7EB;}
.mobile-slider { -webkit-appearance: none; width: 100%; height: 6px; border-radius: 3px; background: #D1D5DB; outline: none; }
.mobile-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #111827; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }

.basic-configs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.input-col { display: flex; flex-direction: column; gap: 8px; }
.input-col label { font-size: 13px; font-weight: 600; color: #4B5563; }
.clean-input { padding: 12px; background: #ffffff; border: 1px solid #D1D5DB; border-radius: 8px; font-size: 14px; font-family: inherit; color: #111827; width: 100%; box-sizing: border-box;}
.clean-input:focus { outline: none; border-color: #111827; }
textarea.clean-input { resize: vertical; }

.text-editor-panel { background: #ffffff; border: 1px solid #E5E7EB; border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 20px; }

/* Responsive */
@media (max-width: 900px) {
  .live-editor-grid { grid-template-columns: 1fr; gap: 24px; }
  .preview-panel { padding: 24px; }
  .ws-head { flex-direction: column; align-items: flex-start; }
  .ws-actions { width: 100%; }
  .ws-actions button { flex: 1; }
}
@media (max-width: 480px) {
  .accordion-header { flex-direction: column; align-items: flex-start; gap: 12px; }
  .btn-edit-toggle { width: 100%; text-align: center; padding: 10px; }
  .basic-configs { grid-template-columns: 1fr; }
  .compression-toggle-bar { flex-direction: column; align-items: flex-start; }
}
</style>