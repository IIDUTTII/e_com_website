<script setup>
import { ref, onMounted, computed } from 'vue'
import { fetchAboutConfig } from './db.js'

defineOptions({ name: 'AboutView' })

const aboutData = ref(null)
const loading = ref(true)

const displayData = computed(() => ({
  text: {
    heroTitle: aboutData.value?.text?.heroTitle || 'About Us',
    section1Body: aboutData.value?.text?.section1Body || 'Loading content...',
    section2Body: aboutData.value?.text?.section2Body || '',
    founderQuote: aboutData.value?.text?.founderQuote || 'Preserving mountain heritage, one product at a time.'
  },
  images: {
    hero: aboutData.value?.images?.hero || '',
    village: aboutData.value?.images?.village || '',
    family: aboutData.value?.images?.family || '',
    founder: aboutData.value?.images?.founder || '',
    valley: aboutData.value?.images?.valley || ''
  }
}))

onMounted(async () => {
  try {
    aboutData.value = await fetchAboutConfig()
  } catch (e) {
    console.error('Fetch About Config Error:', e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="about-page-wrapper fade-in">
    
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
    </div>

<div v-else class="about-container">
      
      <header class="about-hero">
        <h1 class="hero-title">{{ displayData.text.heroTitle }}</h1>
        <p class="hero-subtitle">Seedha Pahadon Se: Shuddh, Pahari, Asli</p>
        <div class="hero-image">
          <img :src="displayData.images.hero" alt="Scenic Himalayan Mountains" class="hero-img hero-pos">
        </div>
      </header>
      
      <section class="story-section alternating-layout">
        <div class="text-content">
          <h2>The Mountain Way of Life</h2>
          <p class="pre-wrap-text">{{ displayData.text.section1Body }}</p>
        </div>
        <div class="image-content">
          <img :src="displayData.images.village" alt="Traditional Himalayan village" class="section-img village-pos">
        </div>
      </section>
      
      <section class="story-section alternating-layout reverse">
        <div class="image-content">
          <img :src="displayData.images.family" alt="Local Himachali family" class="section-img family-pos">
        </div>
        <div class="text-content">
          <h2>Bridging Communities to You</h2>
          <p class="pre-wrap-text">{{ displayData.text.section2Body }}</p>
          <ul class="mission-list">
            <li><strong>Support Local Families:</strong> Sourced from 25+ households across the valley.</li>
            <li><strong>Fair Value:</strong> Eliminating middlemen so fair prices reach producers.</li>
            <li><strong>Preserve Heritage:</strong> Sustaining traditional knowledge and skills.</li>
            <li><strong>Authentic Products:</strong> Exactly what the mountain families prepared.</li>
          </ul>
        </div>
      </section>

      <section class="story-section alternating-layout">
        <div class="text-content">
          <h2>Meet Our Founder</h2>
          <p><strong>Bhawani Dutt</strong> was born and raised in the heart of Himachal Pradesh, surrounded by the very mountains and communities that PahadS now serves.</p>
          <p>After spending years in the corporate world, he realized that the traditional knowledge of his homeland was slowly fading away.</p>
          <p>That's when he decided to return to his roots. PahadS was born not as a business, but as a mission.</p>
        </div>
        <div class="image-content">
          <img :src="displayData.images.founder" alt="Founder Bhawani Dutt" class="section-img founder-pos">
        </div>
      </section>
      
      <div class="section-divider"></div>

      <section class="promise-section">
        <div class="promise-header">
          <h2>Our Promise to You</h2>
          <p class="subtitle">We do not aim to be the biggest brand. We aim to be the brand you trust.</p>
        </div>
        
        <div class="promise-grid">
          <div class="promise-card">
            <span class="promise-icon">🌿</span>
            <h4>Carefully Selected</h4>
            <p>Only the purest, most authentic provisions make it from our hills to your home.</p>
          </div>
          <div class="promise-card">
            <span class="promise-icon">⚖️</span>
            <h4>Honest Sourcing</h4>
            <p>Transparent information, fair trade with farmers, and respect for tradition.</p>
          </div>
          <div class="promise-card">
            <span class="promise-icon">🛡️</span>
            <h4>Food Safety Compliant</h4>
            <p>High standards of hygiene without losing the raw authenticity.</p>
            <span class="fssai-code">FSSAI: XXXXXXXXXXXXXX</span>
          </div>
          <div class="promise-card">
            <span class="promise-icon">🏔️</span>
            <h4>Community First</h4>
            <p>Every purchase supports multiple mountain families, not just one producer.</p>
          </div>
        </div>
      </section>
      
      <div class="section-divider"></div>

      <section class="community-section">
        <div class="soft-card">
          <h3>Our Home</h3>
          <p class="location-text"><strong>Seraj Valley</strong><br>Mandi District, Himachal Pradesh</p>
          <p class="card-desc">From this small valley, we coordinate with local families who produce traditional goods using methods passed down for generations. We don't own farms — we partner with families who do.</p>
          <div class="small-img-container">
            <img :src="displayData.images.valley" alt="Seraj Valley landscape" class="small-img valley-pos">
          </div>
        </div>
        
        <div class="soft-card">
          <h3>Follow Our Journey</h3>
          <p class="card-desc">Join our growing community. We regularly share stories of the families we work with, behind-the-scenes harvest moments, and glimpses of authentic Himachali life.</p>
          <div class="social-links">
            <a href="#" class="social-btn">📷 Instagram @PahadS</a>
            <a href="#" class="social-btn">📘 Facebook @PahadS</a>
            <a href="#" class="social-btn">▶️ YouTube @PahadS</a>
          </div>
        </div>
      </section>

      <section class="quote-section">
        <blockquote class="clean-quote">
          {{ displayData.text.founderQuote }}
        </blockquote>
        <div class="quote-author">
          <strong>Bhawani Dutt</strong>
          <span>Founder, PahadS</span>
        </div>
      </section>

      <section class="thankyou-section">
        <h2>Thank You</h2>
        <p>Your support helps preserve traditional knowledge and sustains multiple families across Himachal Pradesh. We look forward to serving you.</p>
        <div class="signature">
          <p>With gratitude,</p>
          <strong>Team PahadS</strong>
        </div>
      </section>
      
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Cinzel:wght@600;800&display=swap');

/* Loading State */
.loading-state { min-height: 60vh; display: flex; align-items: center; justify-content: center; }
.spinner { width: 40px; height: 40px; border: 3px solid #E5E7EB; border-top-color: #111827; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.pre-wrap-text { white-space: pre-wrap; }

/* ─── BASE STYLES ─── */
.fade-in { animation: fIn 0.4s ease-out; }
@keyframes fIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

.about-page-wrapper {
  background-color: #ffffff; 
  min-height: 100vh;
  padding: 100px 24px 80px;
  box-sizing: border-box;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #111827;
  overflow-x: hidden;
}

.about-container { max-width: 1100px; margin: 0 auto; }

/* ─── HERO ─── */
.about-hero { text-align: center; margin-bottom: 80px; }
.hero-title { font-family: 'Cinzel', serif; font-size: 3.5rem; font-weight: 800; color: #111827; margin: 0 0 12px; letter-spacing: -1px;}
.hero-subtitle { font-size: 1.1rem; color: #059669; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 40px; }
.hero-image { width: 100%; height: 500px; border-radius: 24px; overflow: hidden; }
.hero-img { width: 100%; height: 100%; object-fit: cover; }

/* ─── STORY SECTIONS ─── */
.story-section { margin-bottom: 80px; }
.alternating-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
.alternating-layout.reverse .text-content { order: 2; }
.alternating-layout.reverse .image-content { order: 1; }

.text-content h2 { font-family: 'Cinzel', serif; font-size: 2.4rem; font-weight: 800; margin: 0 0 24px 0; color: #111827; line-height: 1.1; }
.text-content p { font-size: 1.05rem; line-height: 1.8; color: #4B5563; margin: 0 0 20px 0; }

.mission-list { list-style: none; margin: 0 0 24px 0; padding-left: 0; }
.mission-list li { font-size: 1rem; color: #4B5563; margin-bottom: 14px; padding-left: 28px; position: relative; line-height: 1.6; }
.mission-list li::before { content: '✓'; position: absolute; left: 0; color: #10B981; font-weight: 800; background: #DCFCE7; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 10px; top: 4px;}

.image-content { width: 100%; border-radius: 24px; overflow: hidden; }
.section-img { width: 100%; object-fit: cover; border-radius: 24px; transition: transform 0.4s ease; }
.section-img:hover { transform: scale(1.03); }

.section-divider { height: 1px; background-color: #E5E7EB; width: 100%; margin: 80px 0; }

/* ─── PROMISES ─── */
.promise-header { text-align: center; margin-bottom: 48px; }
.promise-header h2 { font-family: 'Cinzel', serif; font-size: 2.5rem; font-weight: 800; color: #111827; margin: 0 0 12px; }
.subtitle { font-size: 1.1rem; color: #6B7280; font-weight: 500; margin: 0; }

.promise-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; }
.promise-card { background-color: #F9FAFB; border-radius: 20px; padding: 40px 24px; text-align: center; transition: transform 0.2s ease; border: 1px solid transparent;}
.promise-card:hover { transform: translateY(-4px); background-color: #ffffff; border-color: #E5E7EB; box-shadow: 0 10px 30px rgba(0,0,0,0.03);}
.promise-icon { font-size: 2.5rem; display: block; margin-bottom: 20px; }
.promise-card h4 { font-size: 1.2rem; font-weight: 700; margin: 0 0 12px; color: #111827; }
.promise-card p { font-size: 0.95rem; color: #6B7280; line-height: 1.6; margin: 0; }
.fssai-code { display: inline-block; margin-top: 20px; background-color: #E5E7EB; padding: 6px 12px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; color: #374151; }

/* ─── COMMUNITY ─── */
.community-section { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.soft-card { background-color: #F9FAFB; border-radius: 24px; padding: 48px; }
.soft-card h3 { font-family: 'Cinzel', serif; font-size: 1.8rem; font-weight: 800; margin: 0 0 16px; color: #111827;}
.location-text { font-size: 1.1rem; color: #059669; margin-bottom: 16px; }
.card-desc { font-size: 1rem; color: #4B5563; line-height: 1.7; margin-bottom: 24px; }

.small-img-container { margin-top: 24px; border-radius: 16px; overflow: hidden; }
.small-img { width: 100%; height: 200px; object-fit: cover; border-radius: 16px; }

.social-links { display: flex; flex-direction: column; gap: 12px; }
.social-btn { display: block; text-align: center; background-color: #ffffff; border: 1px solid #E5E7EB; color: #111827; padding: 16px; border-radius: 12px; font-weight: 600; text-decoration: none; transition: 0.2s; font-size: 14px;}
.social-btn:hover { background-color: #111827; color: #ffffff; border-color: #111827; }

/* ─── CLEAN QUOTE SECTION ─── */
.quote-section { margin-top: 80px; text-align: center; padding: 64px 24px; }
.clean-quote { font-family: 'Georgia', serif; font-size: 2rem; line-height: 1.5; font-style: italic; color: #111827; max-width: 900px; margin: 0 auto 32px; letter-spacing: -0.5px;}
.quote-author strong { display: block; font-size: 1.2rem; font-weight: 700; color: #059669; margin-bottom: 4px; }
.quote-author span { font-size: 0.95rem; color: #6B7280; text-transform: uppercase; letter-spacing: 1px; }

/* ─── THANK YOU ─── */
.thankyou-section { text-align: center; margin-top: 60px; max-width: 600px; margin: 60px auto 0; }
.thankyou-section h2 { font-family: 'Cinzel', serif; font-size: 2rem; font-weight: 800; color: #111827; margin-bottom: 20px; }
.thankyou-section p { font-size: 1.05rem; line-height: 1.7; color: #4B5563; margin-bottom: 16px; }
.signature { margin-top: 32px; }
.signature p { margin: 4px 0; color: #6B7280; font-style: italic; }
.signature strong { color: #111827; font-size: 1.1rem; font-style: normal;}

/* ─── IMAGE RATIO POSITIONING ─── */
.hero-pos { object-position: center 60%; }
.village-pos { object-fit: cover; transform: scale(1.19); transform-origin: 55% 18%; }
.section-img:hover.village-pos { transform: scale(1.23); } 
.family-pos { width: 92%; aspect-ratio: 9/16; object-fit: cover; object-position: center 50%; margin: 0 auto; display: block; }
.founder-pos { width: 85%; aspect-ratio: 1/1; object-fit: cover; margin: 0 auto; display: block; }
.valley-pos { aspect-ratio: 3/4; object-position: center 60%; }

/* ─── MOBILE RESPONSIVENESS ─── */
@media(max-width: 900px) {
  .alternating-layout, .community-section { grid-template-columns: 1fr; gap: 48px; }
  .alternating-layout.reverse .text-content { order: 1; }
  .alternating-layout.reverse .image-content { order: 2; }
  
  .hero-title { font-size: 2.5rem; }
  .hero-image { height: 350px; }
  .clean-quote { font-size: 1.5rem; }
  .text-content h2, .promise-header h2 { font-size: 2rem; }
  
  .family-pos { aspect-ratio: 4/3; width: 100%; }
  .valley-pos { aspect-ratio: 4/3; width: 100%; }
  .founder-pos { width: 90%; aspect-ratio: 1/1; }
}

@media(max-width: 768px) {
  .about-page-wrapper { padding: 80px 16px 80px; }
  .about-hero { margin-bottom: 56px; }
  
  .hero-image { 
    border-radius: 0; 
    width: 100vw; 
    position: relative; 
    left: 50%; right: 50%; 
    margin-left: -50vw; margin-right: -50vw; 
    height: 300px;
  }
  
  .hero-title { font-size: 2.2rem; }
  .soft-card { padding: 32px 24px; }
  .promise-card { padding: 32px 20px; }
  .quote-section { padding: 48px 16px; margin-top: 40px; }
  
  .family-pos { aspect-ratio: 3/4; width: 100%; }
  .valley-pos { aspect-ratio: 1/1; width: 100%; }
  .founder-pos { width: 100%; aspect-ratio: 1/1; }
}
</style>