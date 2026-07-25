/**
 * db.js  —  Single source of truth for ALL Firebase operations.
 * ─────────────────────────────────────────────────────────────────────────────
 * Rules:
 * • Vue files NEVER import from firebase directly — only from here.
 * • Every read is cached in memory to avoid repeat Firestore charges.
 * • Cache is busted only when a write happens that affects the cached data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db, auth } from '../firebase.js'
import {
  collection, getDocs, getDoc, query, where, onSnapshot,
  doc, setDoc, updateDoc, deleteDoc, addDoc, increment, serverTimestamp, arrayUnion,
  limit, orderBy
} from 'firebase/firestore'
import { signOut, sendPasswordResetEmail, createUserWithEmailAndPassword, signInWithPopup, updateProfile, sendEmailVerification, GoogleAuthProvider } from 'firebase/auth'

import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject, listAll, getMetadata } from 'firebase/storage'
import imageCompression from 'browser-image-compression'
import { storage } from '../firebase.js'

// In-Memory Cache Layer
let _activeProductsCache = null
const googleProvider = new GoogleAuthProvider();
const _productCache = new Map()
const _cartCache = new Map()
const _userRoleCache = new Map()
const _viewedThisSession = new Set()
let _gatewayConfigCache = null
let _shippingConfigCache = null
const _configCacheTtlMs = 5 * 60 * 1000
let _gatewayConfigCachedAt = 0
let _shippingConfigCachedAt = 0


export { db, auth, storage }
export const ORDER_STATUS_FLOW = ['pending', 'confirmed', 'shipped', 'delivered']
export const ORDER_TERMINAL_STATUSES = ['rejected', 'cancelled']

export const ORDER_STATUS_LABELS = {
  pending: 'Pending Confirmation',
  confirmed: 'Confirmed — Preparing',
  shipped: 'Shipped — In Transit',
  delivered: 'Delivered',
  rejected: 'Rejected by Store',
  cancelled: 'Cancelled',
}

export function formatOrderStatus(status = 'pending') {
  return ORDER_STATUS_LABELS[status] || status
}

export function isOrderActive(status = 'pending') {
  return ORDER_STATUS_FLOW.includes(status)
}

function _bustProductListCache() {
  _activeProductsCache = null
}


export function subscribeToAuditLogsPaginated(limitCount, cb) {
  const q = query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(limitCount));
  return onSnapshot(q, cb);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

export async function logProductView(productId) {
  if (_viewedThisSession.has(productId)) return
  _viewedThisSession.add(productId)

  try {
    await updateDoc(doc(db, 'products', productId), { viewCount: increment(1) })
    const userId = auth.currentUser?.uid ?? 'anonymous'
    await addDoc(collection(db, 'productViews'), {
      productId,
      userId,
      viewedAt: serverTimestamp(),
    })
  } catch (e) {
    console.warn('logProductView failed silently:', e.message)
  }
}


/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CMS Configuration Fetchers (Landing, About, Auth)
 * Add these to your db.js file
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function fetchAuthConfig() {
  try {
    const snap = await getDoc(doc(db, 'systemConfig', 'authPages'))
    if (snap.exists()) return snap.data()
    // Fallback defaults
    return {
      loginBg: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/other%2Funnamed.jpg?alt=media&token=2a8a1cdf-09e6-4d4f-a92b-3879d4a4c3a6',
      registerBg: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/other%2Funnamed%20(11).jpg?alt=media&token=6d7b1ada-9ac9-4749-b8e3-c434da20c984'
    }
  } catch (e) {
    console.error('Fetch Auth Config Error:', e)
    return { loginBg: '', registerBg: '' }
  }
}

export async function fetchAboutConfig() {
  try {
    const snap = await getDoc(doc(db, 'aboutConfig', 'main'))
    if (snap.exists()) return snap.data()
    // Fallback defaults matching your original layout
    return {
      images: {
        hero: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fhero2.jpg?alt=media&token=ff12c12e-3078-411a-bc76-f36b6928eaf1',
        village: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fvillage-women.jpg?alt=media&token=2b210d97-e255-499f-a4ab-98f6f67da6bc',
        family: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fvillage.jpg?alt=media&token=87f75b78-6bc9-40b0-965a-09efd60260d4',
        valley: 'https://images.pexels.com/photos/3057904/pexels-photo-3057904.jpeg',
        founder: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Ffounder.jpg?alt=media&token=afb61aba-bbba-4974-a4d2-4416332d01db'
      },
      text: {
        heroTitle: 'Life in the Himalayas',
        section1Body: 'The Himalayan region is known for its pristine environment, traditional lifestyles, and rich agricultural heritage. For us, the mountains are not just where we live—they are the very essence of who we are.',
        section2Body: 'PahadS is more than a storefront; it is a bridge connecting you directly to the authentic mountain families of Himachal Pradesh.',
        founderQuote: '"I don\'t own farms or produce everything myself. What I do have is deep respect for the mountain families I grew up around. PahadS is my effort to bring their honest work to people who will appreciate it."'
      }
    }
  } catch (e) {
    console.error('Fetch About Config Error:', e)
    return {
      images: {
        hero: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fhero2.jpg?alt=media&token=ff12c12e-3078-411a-bc76-f36b6928eaf1',
        village: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fvillage-women.jpg?alt=media&token=2b210d97-e255-499f-a4ab-98f6f67da6bc',
        family: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fvillage.jpg?alt=media&token=87f75b78-6bc9-40b0-965a-09efd60260d4',
        valley: 'https://images.pexels.com/photos/3057904/pexels-photo-3057904.jpeg',
        founder: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Ffounder.jpg?alt=media&token=afb61aba-bbba-4974-a4d2-4416332d01db'
      },
      text: {
        heroTitle: 'Life in the Himalayas',
        section1Body: 'The Himalayan region is known for its pristine environment, traditional lifestyles, and rich agricultural heritage. For us, the mountains are not just where we live—they are the very essence of who we are.',
        section2Body: 'PahadS is more than a storefront; it is a bridge connecting you directly to the authentic mountain families of Himachal Pradesh.',
        founderQuote: '"I don\'t own farms or produce everything myself. What I do have is deep respect for the mountain families I grew up around. PahadS is my effort to bring their honest work to people who will appreciate it."'
      }
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// 🖼️ IMAGE PROCESSING, UPLOAD & STORAGE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export const uploadProductImage = async (file, folderId) => {
  const options = {
    maxSizeMB: 0.3, // 300kb max for high-speed e-commerce
    maxWidthOrHeight: 1200,
    useWebWorker: true
  }
  const compressedFile = await imageCompression(file, options)
  const fileExt = file.name.split('.').pop()
  const filePath = `products/${folderId}/${Date.now()}_${Math.floor(Math.random()*1000)}.${fileExt}`
  
  const imageRef = storageRef(storage, filePath)
  await uploadBytes(imageRef, compressedFile)
  return await getDownloadURL(imageRef)
}

// 1. Get all images from a product's storage folder
export async function fetchAllProductImages(productId) {
  if (!productId) return []
  try {
    const folderRef = storageRef(storage, `products/${productId}`)
    const result = await listAll(folderRef)
    
    // Get download URLs for all files in the folder
    const urls = await Promise.all(
      result.items.map(async (itemRef) => {
        return await getDownloadURL(itemRef)
      })
    )
    return urls
  } catch (e) {
    if (e.code === 'storage/object-not-found' || e.code === 'storage/project-not-found') {
      return []
    }
    throw e
  }
}

// 2. Delete image from Storage (already provided, ensure it's exported)
export const deleteProductImage = async (fileUrl) => {
  if (!fileUrl || !fileUrl.includes('firebasestorage.googleapis.com')) return
  try {
    const fileRef = storageRef(storage, fileUrl)
    await deleteObject(fileRef)
  } catch (e) {
    throw e
  }
}

export async function getStorageFileSizeLabel(fileUrl) {
  if (!fileUrl) return 'Unknown Size'
  const bytes = (await getMetadata(storageRef(storage, fileUrl))).size || 0
  if (bytes === 0) return '0 Bytes'
  const units = ['Bytes', 'KB', 'MB', 'GB']
  const idx = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${parseFloat((bytes / Math.pow(1024, idx)).toFixed(2))} ${units[idx]}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 👤 AUTHENTICATION & USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchUserRole() {
  const user = auth.currentUser
  if (!user) return 'user'

  if (_userRoleCache.has(user.uid)) {
    return _userRoleCache.get(user.uid)
  }

  try {
    const snap = await getDoc(doc(db, 'users', user.uid))
    const role = snap.exists() ? (snap.data().role ?? 'user').trim().toLowerCase() : 'user'
    _userRoleCache.set(user.uid, role)
    return role
  } catch (e) {
    console.error('fetchUserRole error:', e)
    return 'user'
  }
}

export const fetchAllUsersFromDb = async () => {
  try {
    const snap = await getDocs(collection(db, 'users'))
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  } catch (error) {
    console.error("Critical failure during users mapping sync processing:", error)
    throw error
  }
}


export async function addUserNote(userId, noteText) {
  if (!userId || !noteText?.trim()) throw new Error('NOTE_REQUIRED')
  const ref = await addDoc(collection(db, 'users', userId, 'notes'), {
    text: noteText.trim(),
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser?.uid || null,
    createdByEmail: auth.currentUser?.email || null,
  })
  await createAuditLog('ADD_USER_NOTE', 'user', userId, null, { noteId: ref.id, text: noteText.trim() })
  return ref.id
}

export async function fetchUserNotes(userId) {
  if (!userId) return []
  const q = query(collection(db, 'users', userId, 'notes'), orderBy('createdAt', 'desc'), limit(20))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function requestUserDisabledChange(userId, disabled) {
  if (!userId) throw new Error('USER_ID_REQUIRED')
  const actorRole = await fetchUserRole()
  if (actorRole !== 'superadmin') throw new Error('ONLY_SUPERADMIN_CAN_BAN_USERS')

  await setDoc(doc(db, 'adminTasks', `user_disabled_${userId}_${Date.now()}`), {
    type: 'SET_USER_DISABLED',
    userId,
    disabled: !!disabled,
    status: 'pending',
    requestedBy: auth.currentUser?.uid || null,
    requestedAt: serverTimestamp(),
  })
  await updateDoc(doc(db, 'users', userId), { disabled: !!disabled })
  await createAuditLog('REQUEST_USER_DISABLED_CHANGE', 'user', userId, null, { disabled: !!disabled })
}

export const updateUserRoleInDb = async (userId, newRole) => {
  try {
    const actorRole = await fetchUserRole()

    if (newRole === 'superadmin' && actorRole !== 'superadmin') {
      throw new Error('ONLY_SUPERADMIN_CAN_ASSIGN_SUPERADMIN')
    }

    const userRef = doc(db, 'users', userId)
    const oldSnap = await getDoc(userRef)
    const oldData = oldSnap.exists() ? oldSnap.data() : null

    await updateDoc(userRef, { role: newRole })

    await createAuditLog('ROLE_CHANGE', 'user', userId, oldData, { role: newRole })
  } catch (error) {
    console.error("Role elevation transaction aborted:", error)
    throw error
  }
}

export const updateUserDisplayName = async (uid, newName) => {
  await updateDoc(doc(db, "users", uid), { displayName: newName })
}

export function getCurrentUser() {
  return auth.currentUser
}

export async function logoutUser() {
  _activeProductsCache = null
  _productCache.clear()
  _cartCache.clear()
  _userRoleCache.clear()
  _viewedThisSession.clear()
  await signOut(auth)
}

export const createUserDocument = async (userData) => {
  await setDoc(doc(db, 'users', userData.uid), { ...userData, createdAt: new Date() }, { merge: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// 👤 AUTHENTICATION & USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const registerUserWithEmail = async (email, password, fullName) => {
  // 1. Create Firebase Auth User
  const result = await createUserWithEmailAndPassword(auth, email, password)
  const user = result.user

  // 2. CRITICAL FIX: Save to Firestore IMMEDIATELY
  const userRef = doc(db, 'users', user.uid)
  await setDoc(userRef, {
    uid: user.uid,
    email: user.email,
    displayName: fullName,
    role: 'user',
    disabled: false, // Prevents errors in admin panel
    emailVerified: false,
    createdAt: serverTimestamp()
  })

  // 3. Safely handle side-effects
  try {
    await updateProfile(user, { displayName: fullName })
    await sendEmailVerification(user)
  } catch (err) {
    console.warn("Verification email limit or profile issue. Skipping gracefully.", err)
  }

  // 4. Force logout so user has to verify email first
  await logoutUser()
}

export const registerUserWithGoogle = async (fullName) => {
  // 1. Authenticate with Google
  const result = await signInWithPopup(auth, googleProvider)
  const user = result.user

  const userRef = doc(db, 'users', user.uid)
  const snap = await getDoc(userRef)
  
  // 2. If new user, save to database
  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: fullName || user.displayName || 'Google User',
      role: 'user',
      disabled: false,
      emailVerified: user.emailVerified,
      createdAt: serverTimestamp()
    })

    try {
      await updateProfile(user, { displayName: fullName })
    } catch(err) {
      console.warn("Profile update delayed:", err)
    }
  }
  return user
}


export const dispatchPasswordResetToken = async (clientEmail) => {
  if (!clientEmail || !clientEmail.trim()) throw new Error('EMAIL_REQUIRED')
  try {
    await sendPasswordResetEmail(auth, clientEmail.trim())
  } catch (error) {
    console.error('Database Layer — Reset Link Transmission Failure:', error.code)
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 📦 PRODUCTS INVENTORY & PAGINATION
// ─────────────────────────────────────────────────────────────────────────────

export function subscribeToProducts(cb) {
  return onSnapshot(collection(db, 'products'), cb)
}

export function subscribeToProductsPaginated(limitCount, cb) {
  const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'), limit(limitCount))
  return onSnapshot(q, cb)
}

export function subscribeToProductsLimited(limitCount, cb) {
  const q = query(collection(db, 'products'), limit(limitCount))
  return onSnapshot(q, cb)
}

export async function fetchActiveProducts() {
  const q = query(collection(db, 'products'), where('isActive', '==', true))
  const snap = await getDocs(q)
  const products = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  
  // ✨ Sort by Admin Priority Order (1 comes first, if no priority, goes to bottom)
  products.sort((a, b) => {
    const orderA = a.priorityOrder || 9999
    const orderB = b.priorityOrder || 9999
    return orderA - orderB
  })
  
  return products
}

export async function fetchAllProducts() {
  const snap = await getDocs(collection(db, 'products'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function fetchProductCategories() {
  const products = await fetchAllProducts()
  const cats = new Set(products.map(p => p.category).filter(Boolean))
  return Array.from(cats)
}

export async function fetchProductById(productId) {
  if (_productCache.has(productId)) {
    return _productCache.get(productId)
  }
  const snap = await getDoc(doc(db, 'products', productId))
  if (!snap.exists()) return null
  const product = { id: snap.id, ...snap.data() }
  _productCache.set(productId, product)
  return product
}

export const fetchProductBySlug = async (slug) => {
  if (!slug) return null
  try {
    if (_activeProductsCache) {
      const match = _activeProductsCache.find(p => p.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') === slug)
      if (match) return match
    }
    const q = query(collection(db, 'products'), where('isActive', '==', true))
    const snap = await getDocs(q)
    const allActive = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    
    const match = allActive.find(p => p.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') === slug)
    return match || null
  } catch (error) {
    console.error("Critical failure looking up slug reference:", error)
    return null
  }
}

export async function addProduct(payload) {
  const ref = await addDoc(collection(db, 'products'), {
    ...payload,
    createdAt: serverTimestamp(),
  })

  await createAuditLog('CREATE_PRODUCT', 'product', ref.id, null, payload)

  _bustProductListCache()
  return ref.id
}

export async function updateProduct(productId, payload) {
  const oldSnap = await getDoc(doc(db, 'products', productId))
  const oldData = oldSnap.exists() ? oldSnap.data() : null

  await updateDoc(doc(db, 'products', productId), payload)

  await createAuditLog('UPDATE_PRODUCT', 'product', productId, oldData, payload)

  if (_productCache.has(productId)) {
    _productCache.set(productId, { ..._productCache.get(productId), ...payload })
  }
  _bustProductListCache()
}

export async function toggleProductActive(productId, currentValue) {
  const newValue = !currentValue
  const oldSnap = await getDoc(doc(db, 'products', productId))
  const oldData = oldSnap.exists() ? oldSnap.data() : null

  await updateDoc(doc(db, 'products', productId), { isActive: newValue })

  await createAuditLog('TOGGLE_PRODUCT_ACTIVE', 'product', productId, oldData, { isActive: newValue })

  if (_productCache.has(productId)) {
    _productCache.set(productId, { ..._productCache.get(productId), isActive: newValue })
  }
  _bustProductListCache()
}

export async function deleteProduct(productId) {
  const oldSnap = await getDoc(doc(db, 'products', productId))
  const oldData = oldSnap.exists() ? oldSnap.data() : null

  await deleteDoc(doc(db, 'products', productId))

  await createAuditLog('DELETE_PRODUCT', 'product', productId, oldData, null)

  _productCache.delete(productId)
  _bustProductListCache()
}

// ─────────────────────────────────────────────────────────────────────────────
// 🛒 CART & CHECKOUT SYSTEMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Batch-fetch live stock for cart items.
 * Returns a Map keyed by `${productId}::${variantLabel}` → { stock, price, isActive, variantActive }
 * Used by cartview.vue and checkout.vue to show out-of-stock warnings.
 */
export async function fetchCartItemsStock(cartItems) {
  const stockMap = new Map()
  if (!cartItems || cartItems.length === 0) return stockMap

  const uniqueProductIds = [...new Set(cartItems.map(i => i.productId))]
  
  try {
    const results = await Promise.allSettled(
      uniqueProductIds.map(id => getDoc(doc(db, 'products', id)))
    )

    const productDataMap = new Map()
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value.exists()) {
        productDataMap.set(uniqueProductIds[idx], r.value.data())
      }
    })

    for (const item of cartItems) {
      const product = productDataMap.get(item.productId)
      if (!product) {
        stockMap.set(`${item.productId}::${item.variant || item.weight || 'Standard'}`, {
          stock: 0, price: item.price, isActive: false, variantActive: false
        })
        continue
      }

      const variantLabel = item.variant || item.weight || 'Standard'
      const variants = product.variants || []
      const variant = variants.find(v => v.label === variantLabel)

      if (!variant) {
        stockMap.set(`${item.productId}::${variantLabel}`, {
          stock: 0, price: item.price, isActive: product.isActive !== false, variantActive: false
        })
        continue
      }

      stockMap.set(`${item.productId}::${variantLabel}`, {
        stock: Number(variant.stock) || 0,
        price: Number(variant.price) || item.price,
        isActive: product.isActive !== false,
        variantActive: variant.active !== false,
      })
    }
  } catch (e) {
    console.warn('fetchCartItemsStock failed:', e.message)
  }

  return stockMap
}

export async function fetchCart() {
  const user = auth.currentUser
  if (!user) return []
  if (_cartCache.has(user.uid)) return _cartCache.get(user.uid).items ?? []
  
  const snap = await getDoc(doc(db, 'carts', user.uid))
  const data = snap.exists() ? snap.data() : { items: [] }
  _cartCache.set(user.uid, data)
  return data.items ?? []
}

export function bustCartCache() {
  const user = auth.currentUser
  if (user) _cartCache.delete(user.uid)
}

// ✨ STRICT CHECK: Matches exactly Product ID + Variant
export async function isVariantInCart(productId, variantLabel) {
  const items = await fetchCart()
  const checkLabel = variantLabel || 'Standard'
  return items.some(i => {
     const existingVar = i.variant || i.weight || 'Standard';
     return i.productId === productId && existingVar === checkLabel;
  })
}

// ✨ FIX: Never merges different variants. Each gets a unique row.
export async function addProductToCart(product, finalPrice, selectedVariant = null, quantity = 1) {
  const user = auth.currentUser
  if (!user) throw new Error('NOT_LOGGED_IN')

  const slug = product.name ? product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') : 'product'
  const primaryImg = (product.imageUrls && product.imageUrls.length > 0) ? product.imageUrls[0] : null
  
  const variantLabel = selectedVariant ? selectedVariant.label : (product.weight || 'Standard')
  const variantId = selectedVariant?.variantId || variantLabel
  // Creates a strictly unique ID for the cart row
  const cartItemId = `${product.id}_${variantId.replace(/[^a-zA-Z0-9]/g, '')}`

  const cartRef = doc(db, 'carts', user.uid)
  const snap = await getDoc(cartRef)
  const data = snap.exists() ? snap.data() : { items: [] }
  const items = data.items || []

  // Check if EXACT variant is already in cart
  const existingIdx = items.findIndex(i => {
     const existingVar = i.variant || i.weight || 'Standard';
     return i.productId === product.id && existingVar === variantLabel;
  })

  if (existingIdx > -1) {
     // If same variant exists, just increase quantity
     items[existingIdx].quantity += quantity
     await setDoc(cartRef, { items }, { merge: true })
  } else {
     // If it's a NEW variant, create a totally separate row!
     items.push({
       cartItemId: cartItemId,
       productId : product.id,
       name      : product.name,
       variant   : variantLabel,
       variantId : variantId,
       price     : Number(finalPrice),
       emoji     : product.emoji || '📦',
       imageUrl  : primaryImg,
       slug      : slug,
       quantity  : quantity,
     })
     await setDoc(cartRef, { items }, { merge: true })
  }

  bustCartCache()
}

export async function saveCartItems(updatedItems) {
  const user = auth.currentUser
  if (!user) return
  const cartRef = doc(db, 'carts', user.uid)
  await setDoc(cartRef, { items: updatedItems }, { merge: true })
  bustCartCache()
}


// ─────────────────────────────────────────────────────────────────────────────
// ⭐ PRODUCT REVIEWS (UPDATED LOGIC)
// ─────────────────────────────────────────────────────────────────────────────

export const canUserReviewProduct = async (productId) => {
  const user = auth.currentUser;
  if (!user) return false;
  
  try {
    // Check all orders of this user that are marked as 'delivered'
    const q = query(
      collection(db, 'orders'), 
      where('userId', '==', user.uid), 
      where('shippingStatus', '==', 'delivered')
    );
    const snap = await getDocs(q);
    
    // Check if the specific productId exists in any of those delivered orders
    for (const d of snap.docs) {
      const order = d.data();
      if (order.items && order.items.some(item => item.productId === productId)) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error("Verification error:", error);
    return false;
  }
}



export const addNewUserAddress = async (addressData) => {
  const user = auth.currentUser
  if (!user) throw new Error('NOT_LOGGED_IN')
  
  const userRef = doc(db, 'users', user.uid)
  const uniqueAddressPayload = {
    id: `addr_${Date.now()}`,
    ...addressData,
    pincode: String(addressData.pincode ?? '').trim(),
    phone: String(addressData.phone ?? '').trim(),
    isVerified: true
  }

  await setDoc(userRef, { addresses: arrayUnion(uniqueAddressPayload) }, { merge: true })
}

export const removeUserAddressFromDb = async (addressId) => {
  const user = auth.currentUser
  if (!user) throw new Error('NOT_LOGGED_IN')
  
  const userRef = doc(db, 'users', user.uid)
  try {
    const snap = await getDoc(userRef)
    if (snap.exists()) {
      const currentAddresses = snap.data().addresses || []
      const filteredAddresses = currentAddresses.filter(a => a.id !== addressId)
      await updateDoc(userRef, { addresses: filteredAddresses })
    }
  } catch (error) {
    console.error("Address deletion run aborted:", error)
    throw error
  }
}

export const modifyUserAddressInDb = async (addressId, updatedFields) => {
  const user = auth.currentUser
  if (!user) throw new Error('NOT_LOGGED_IN')
  
  const userRef = doc(db, 'users', user.uid)
  try {
    const snap = await getDoc(userRef)
    if (snap.exists()) {
      const addresses = snap.data().addresses || []
      const idx = addresses.findIndex(a => a.id === addressId)
      if (idx !== -1) {
        // Normalize pincode & phone to strings to prevent type errors
        const normalizedFields = {
          ...updatedFields,
          pincode: String(updatedFields.pincode ?? '').trim(),
          phone: String(updatedFields.phone ?? '').trim(),
        }
        addresses[idx] = { ...addresses[idx], ...normalizedFields }
        await updateDoc(userRef, { addresses })
      }
    }
  } catch (error) {
    console.error("Address mutation run aborted:", error)
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🛒 ORDERS FULFILLMENT & TRACKING
// ─────────────────────────────────────────────────────────────────────────────



async function _resolveOrderContact(order = {}) {
  let email = order.customerEmail || order.email || null
  if (!email && order.userId) {
    try {
      const userSnap = await getDoc(doc(db, 'users', order.userId))
      if (userSnap.exists()) email = userSnap.data().email || null
    } catch (_) { /* non-blocking */ }
  }
  return {
    email,
    phone: order.phone || null,
    name: order.customerName || null,
  }
}

async function _queueOrderStatusNotification(orderId, orderData, status, extra = {}) {
  const templates = {
    confirmed: `Hi ${orderData.customerName || 'Customer'}, your PahadS order ${orderId.slice(0, 8)}… is confirmed and being prepared.`,
    shipped: `Your order is on the way! Tracking ID: ${extra.trackingId || 'Check your orders page'}.`,
    delivered: `Your PahadS order has been delivered. Thank you for shopping with us!`,
    rejected: `Your order was cancelled: ${extra.adminComment || 'Please contact support if you need help.'}`,
  }
  const message = templates[status]
  if (!message) return null

  const contact = await _resolveOrderContact(orderData)
  return createAdminTask('SEND_ORDER_NOTIFICATION', {
    orderId,
    channel: 'email',
    message,
    customerEmail: contact.email,
    customerPhone: contact.phone,
    customerName: contact.name,
    autoTriggered: true,
    status,
  }, 'order', orderId)
}

export function subscribeToOrders(cb) {
  return onSnapshot(collection(db, 'orders'), cb)
}

// Subscribe to payments collection for admin dashboard
export function subscribeToPayments(cb) {
  return onSnapshot(collection(db, 'payments'), cb)
}

export async function fetchPayments() {
  const snap = await getDocs(collection(db, 'payments'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export function subscribeToOrdersPaginated(limitCount, cb) {
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(limitCount))
  return onSnapshot(q, cb)
}

export function subscribeToUserOrders(userId, limitCount, cb) {
  if (!userId) throw new Error('USER_ID_REQUIRED')
  const q = query(
    collection(db, 'orders'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  )
  return onSnapshot(q, cb)
}

//#####################
// ─────────────────────────────────────────────────────────────────────────────
// 🛒 ORDERS FULFILLMENT & TRACKING (STRICT STATE MACHINE)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateOrderStatus(orderId, updates = {}) {
  if (!orderId) throw new Error('ORDER_ID_REQUIRED')
  await updateDoc(doc(db, 'orders', orderId), updates)
}

export async function confirmOrderInDb(orderId, options = {}) {
  await updateOrderStatus(orderId, { shippingStatus: 'confirmed', confirmedAt: serverTimestamp() })
}

export async function shipOrderInDb(orderId, trackingId, options = {}) {
  await updateOrderStatus(orderId, { shippingStatus: 'shipped', trackingId: trackingId.trim(), shippedAt: serverTimestamp() })
}

export async function markOrderDeliveredInDb(orderId, options = {}) {
  await updateOrderStatus(orderId, { shippingStatus: 'delivered', deliveredAt: serverTimestamp() })
}

export async function rejectOrderInDb(orderId, adminComment, options = {}) {
  const ref = doc(db, 'orders', orderId)
  const snap = await getDoc(ref)
  const order = snap.exists() ? snap.data() : null
  
  const reason = adminComment.trim()
  // Strict Refund Logic: Agar online paid tha aur reject hua, toh refund pending mein dalo
  if (order && order.paymentMethod === 'online' && order.paymentStatus === 'paid') {
    await updateOrderStatus(orderId, {
      shippingStatus: 'cancelled_refund_pending',
      cancelReason: reason,
      adminComment: reason,
      refund_status: 'requested',
      refund_reason: 'Order rejected by admin: ' + reason,
      refund_requested_at: serverTimestamp(),
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  } else {
    // COD or unpaid: just cancel/reject
    await updateOrderStatus(orderId, {
      shippingStatus: 'cancelled',
      cancelReason: reason,
      adminComment: reason,
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }
}

// ✨ NEW: STRICT E-COMMERCE ADMIN ACTIONS ✨
export async function processRefundInDb(orderId, refundDetails = {}) {
  /* refundDetails: { txnId, note, processedAt: Date | string }
     Stored so the audit trail of refunds is forever queryable.      */
  const payload = {
    shippingStatus: 'refunded',
    refundedAt: serverTimestamp(),
    refundTransactionId: refundDetails.txnId || '',
    refundNote: refundDetails.note || '',
    refundProcessedAt: refundDetails.processedAt
      ? (refundDetails.processedAt instanceof Date
          ? refundDetails.processedAt
          : new Date(refundDetails.processedAt))
      : serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await updateOrderStatus(orderId, payload)
}

/* Admin force-cancel with auto-refund request.
   Works at any stage EXCEPT delivered/replaced (use Return flow there).
   For online-paid orders → cancelled_refund_pending + refund_status=requested.
   For COD/unpaid → cancelled. */
export async function adminCancelOrderWithRefund(orderId, reason = '') {
  const ref = doc(db, 'orders', orderId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('ORDER_NOT_FOUND')
  const order = snap.data()

  const currentStatus = order.shippingStatus || 'pending'
  if (['delivered', 'replaced', 'refunded', 'rejected'].includes(currentStatus)) {
    throw new Error('Terminal state — use Return flow instead.')
  }

  const isOnlinePaid = order.paymentMethod === 'online' && order.paymentStatus === 'paid'
  const cleanReason = (reason || '').trim() || 'Cancelled by admin'

  const payload = {
    shippingStatus: isOnlinePaid ? 'cancelled_refund_pending' : 'cancelled',
    cancelReason: cleanReason,
    adminComment: cleanReason,
    cancelledAt: serverTimestamp(),
    cancelledBy: auth.currentUser?.uid || 'admin',
    cancellationSource: 'admin_force',
    updatedAt: serverTimestamp(),
  }
  if (isOnlinePaid) {
    payload.refund_status = 'requested'
    payload.refund_reason = cleanReason
    payload.refund_requested_by = payload.cancelledBy
    payload.refund_requested_at = serverTimestamp()
  }
  await updateDoc(ref, payload)
  await createAuditLog('ADMIN_CANCEL_WITH_REFUND', 'order', orderId, order, payload)
}

export async function approveReturnInDb(orderId, paymentMethod) {
  // Agar online tha toh refund logic, COD tha toh bank details ke liye pending
  if (paymentMethod === 'online') {
    await updateOrderStatus(orderId, { shippingStatus: 'returned_refund_pending' })
  } else {
    await updateOrderStatus(orderId, { shippingStatus: 'returned_refund_pending', note: 'Collect Bank Details for COD Return' })
  }
}

export async function rejectReturnInDb(orderId, reason) {
  // Return reject hua toh wapas delivered stage par jayega with rejection note
  await updateOrderStatus(orderId, { shippingStatus: 'delivered', returnRejectReason: reason })
}

export async function approveReplacementInDb(orderId) {
  await updateOrderStatus(orderId, { shippingStatus: 'replacement_approved' })
}

export async function markReplacedInDb(orderId, newTrackingId) {
  await updateOrderStatus(orderId, { shippingStatus: 'replaced', replacementTrackingId: newTrackingId })
}


export async function fetchOrderById(orderId) {
  const snap = await getDoc(doc(db, 'orders', orderId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function cancelCustomerOrder(orderId, cancelReason = '') {
  const user = auth.currentUser
  if (!user) throw new Error('NOT_LOGGED_IN')
  if (!orderId) throw new Error('ORDER_ID_REQUIRED')

  const ref = doc(db, 'orders', orderId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('ORDER_NOT_FOUND')
  
  const order = snap.data()
  if (order.userId !== user.uid) throw new Error('ORDER_ACCESS_DENIED')
  if ((order.shippingStatus || 'pending') !== 'pending') throw new Error('ONLY_PENDING_ORDERS_CAN_BE_CANCELLED')

  // COD orders: just cancel, no refund needed
  // Online paid orders: cancel + mark refund_pending for admin to process
  const isOnlinePaid = order.paymentMethod === 'online' && order.paymentStatus === 'paid'
  
  const payload = {
    shippingStatus: isOnlinePaid ? 'cancelled_refund_pending' : 'cancelled',
    cancelReason: cancelReason.trim() || 'Cancelled by customer',
    cancelledAt: serverTimestamp(),
    cancelledBy: user.uid,
    updatedAt: serverTimestamp(),
  }
  
  // If online paid, also set refund_status so admin sees it
  if (isOnlinePaid) {
    payload.refund_status = 'requested'
    payload.refund_reason = cancelReason.trim() || 'Order cancelled by customer (online payment)'
    payload.refund_requested_by = user.uid
    payload.refund_requested_at = serverTimestamp()
  }
  
  await updateDoc(ref, payload)
  await createAuditLog('CUSTOMER_CANCEL_ORDER', 'order', orderId, order, payload)
}


export async function createAdminTask(type, payload, entityType = 'system', entityId = null) {
  const taskRef = await addDoc(collection(db, 'adminTasks'), {
    type,
    payload,
    status: 'pending',
    requestedBy: auth.currentUser?.uid || null,
    requestedByEmail: auth.currentUser?.email || null,
    requestedAt: serverTimestamp(),
  })
  await createAuditLog(`REQUEST_${type}`, entityType, entityId || taskRef.id, null, payload)
  return taskRef.id
}

export async function requestOrderInvoice(orderId) {
  return createAdminTask('GENERATE_INVOICE', { orderId }, 'order', orderId)
}

export async function requestOrderRefund(orderId, amount, reason) {
  if (!reason?.trim()) throw new Error('REFUND_REASON_REQUIRED')
  return createAdminTask('PROCESS_REFUND', { orderId, amount: Number(amount) || 0, reason: reason.trim() }, 'order', orderId)
}

export async function requestOrderReturn(orderId, reason) {
  if (!reason?.trim()) throw new Error('RETURN_REASON_REQUIRED')
  await updateDoc(doc(db, 'orders', orderId), { returnStatus: 'requested', returnReason: reason.trim() })
  return createAdminTask('PROCESS_RETURN', { orderId, reason: reason.trim() }, 'order', orderId)
}

export async function requestOrderNotification(orderId, channel, message) {
  if (!message?.trim()) throw new Error('MESSAGE_REQUIRED')
  const order = await fetchOrderById(orderId)
  const contact = order ? await _resolveOrderContact(order) : {}
  if (channel === 'email' && !contact.email) throw new Error('CUSTOMER_EMAIL_MISSING')
  if ((channel === 'sms' || channel === 'whatsapp') && !contact.phone) throw new Error('CUSTOMER_PHONE_MISSING')
  return createAdminTask('SEND_ORDER_NOTIFICATION', {
    orderId,
    channel,
    message: message.trim(),
    customerEmail: contact.email,
    customerPhone: contact.phone,
    customerName: contact.name,
    autoTriggered: false,
  }, 'order', orderId)
}
// Add this below approveReplacementInDb in db.js
export async function rejectReplacementInDb(orderId, reason) {
  // Replacement reject hua toh wapas delivered par jayega with rejection note
  await updateOrderStatus(orderId, { 
    shippingStatus: 'delivered', 
    replacementRejectReason: reason 
  })
}

// ✨ CORE ORDER CREATION LOGIC WITH VALIDATIONS & SIDE-EFFECTS ✨  
// ─────────────────────────────────────────────────────────────────────────────
// 🚨 SECURITY: Order creation is now handled server-side via Cloudflare Worker
// Client-side order creation is DISABLED to prevent manipulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated This function is INSECURE and DISABLED.
 * Orders must be created via the server-side worker at /api/create-order.
 * This function now throws an error to prevent misuse.
 */
export const createCustomerOrderDocument = async (orderPayload) => {
  console.error('❌ SECURITY ERROR: createCustomerOrderDocument is deprecated and disabled.');
  console.error('✅ Use the server-side endpoint: /api/create-order');
  throw new Error('Order creation is only allowed via server-side endpoint. Please refresh and try again.');
};

/**
 * ✅ SECURE: Creates an order via Cloudflare Worker
 * This is the RECOMMENDED way to create orders.
 * 
 * @param {Object} orderPayload - The order data (items, address, paymentMethod, totalAmount, etc.)
 * @returns {Promise<Object>} - { orderId, razorpayOrder, razorpayKey }
 */
export const calculateOrderSecure = async (items, couponCode) => {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_LOGGED_IN');
  const idToken = await user.getIdToken();
  const res = await fetch('/api/calculate-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ items, couponCode }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Calculation failed');
  }
  return await res.json();
};

export const createOrderSecure = async (orderPayload) => {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_LOGGED_IN');
  
  try {
    const idToken = await user.getIdToken(true);
    
    const response = await fetch('/api/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(orderPayload),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Order creation failed');
    }
    
    return await response.json();
  } catch (error) {
    console.error('createOrderSecure error:', error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 💰 REFUND MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User requests a refund for an order
 * Only allowed if: paymentStatus === 'paid' AND shippingStatus === 'cancelled'
 */
export async function requestRefund(orderId, reason) {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_LOGGED_IN');
  if (!orderId) throw new Error('ORDER_ID_REQUIRED');
  if (!reason?.trim()) throw new Error('REFUND_REASON_REQUIRED');

  const orderRef = doc(db, 'orders', orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error('ORDER_NOT_FOUND');
  
  const order = snap.data();
  if (order.userId !== user.uid) throw new Error('ORDER_ACCESS_DENIED');
  
  // Only online paid orders can request refund
  if (order.paymentMethod !== 'online' || order.paymentStatus !== 'paid')
    throw new Error('ONLY_ONLINE_PAID_ORDERS_CAN_BE_REFUNDED');
  
  // Must be in cancelled state
  if (!['cancelled', 'cancelled_refund_pending'].includes(order.shippingStatus))
    throw new Error('ONLY_CANCELLED_ORDERS_CAN_BE_REFUNDED');

  await updateDoc(orderRef, {
    refund_status: 'requested',
    refund_reason: reason.trim(),
    refund_requested_by: user.uid,
    refund_requested_at: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createAuditLog('REFUND_REQUESTED', 'order', orderId, null, { reason: reason.trim() });
}

/**
 * Admin approves a refund
 */
export async function approveRefund(orderId) {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_LOGGED_IN');
  
  const role = await fetchUserRole();
  if (!['admin', 'superadmin'].includes(role)) throw new Error('ADMIN_ONLY');

  await updateDoc(doc(db, 'orders', orderId), {
    refund_status: 'approved',
    refund_approved_by: user.uid,
    refund_approved_at: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createAuditLog('REFUND_APPROVED', 'order', orderId, null, { approvedBy: user.uid });
}

/**
 * Admin rejects a refund with reason
 */
export async function rejectRefund(orderId, reason) {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_LOGGED_IN');
  
  const role = await fetchUserRole();
  if (!['admin', 'superadmin'].includes(role)) throw new Error('ADMIN_ONLY');
  if (!reason?.trim()) throw new Error('REJECT_REASON_REQUIRED');

  await updateDoc(doc(db, 'orders', orderId), {
    refund_status: 'rejected',
    refund_reject_reason: reason.trim(),
    refund_rejected_at: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createAuditLog('REFUND_REJECTED', 'order', orderId, null, { reason: reason.trim() });
}

/**
 * Admin marks refund as completed (money sent to customer)
 */
export async function completeRefund(orderId, refundDetails = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_LOGGED_IN');

  const role = await fetchUserRole();
  if (!['admin', 'superadmin'].includes(role)) throw new Error('ADMIN_ONLY');

  const payload = {
    refund_status: 'completed',
    refunded_at: serverTimestamp(),
    shippingStatus: 'refunded',
    updatedAt: serverTimestamp(),
  };
  if (refundDetails.txnId) payload.refundTransactionId = refundDetails.txnId;
  if (refundDetails.note) payload.refundNote = refundDetails.note;
  if (refundDetails.processedAt) {
    payload.refundProcessedAt = (refundDetails.processedAt instanceof Date)
      ? refundDetails.processedAt
      : new Date(refundDetails.processedAt);
  }

  await updateDoc(doc(db, 'orders', orderId), payload);

  await createAuditLog('REFUND_COMPLETED', 'order', orderId, null, {
    completedBy: user.uid,
    txnId: refundDetails.txnId || null,
    note: refundDetails.note || null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 💳 RAZORPAY PAYMENTS (Admin) – with Charge Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate Razorpay charge (2%) and net amount
 * @param {number} amount - Amount in paise (Razorpay format)
 * @returns {Object} - { charge, chargeDisplay, netAmount, netDisplay }
 */
export function calculateRazorpayCharge(amount) {
  // Amount is in paise (e.g., 199900)
  const amountInRupees = amount / 100;
  
  // 2% charge + 18% GST on the charge = 2.36% total
  // Standard Razorpay: 2% + GST (18%) = 2.36%
  const chargePercentage = 2.36; // 2% + 18% GST
  const charge = (amountInRupees * chargePercentage) / 100;
  const netAmount = amountInRupees - charge;
  
  return {
    charge: charge,
    chargeDisplay: '₹' + charge.toFixed(2),
    netAmount: netAmount,
    netDisplay: '₹' + netAmount.toFixed(2),
    percentage: chargePercentage + '%'
  };
}

/**
 * Fetch payments directly from Razorpay API via Cloudflare Worker
 * @param {number} count - Number of payments to fetch (default: 20)
 * @param {number} skip - Number of payments to skip (for pagination)
 * @returns {Promise<Object>} - Razorpay API response with payments array
 */
export const fetchRazorpayPayments = async (count = 20, skip = 0) => {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_LOGGED_IN');
  
  const role = await fetchUserRole();
  if (!['admin', 'superadmin'].includes(role)) {
    throw new Error('ADMIN_ACCESS_REQUIRED');
  }
  
  const idToken = await user.getIdToken();
  const res = await fetch(`/api/razorpay-payments?count=${count}&skip=${skip}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
  });
  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch Razorpay payments');
  }
  
  return await res.json();
};


// ─────────────────────────────────────────────────────────────────────────────
// 📊 ADMIN ANALYTICS & DASHBOARD DATA
// ─────────────────────────────────────────────────────────────────────────────  

// ─────────────────────────────────────────────────────────────────────────────
// ✨ UPDATED ANALYTICS FUNCTION IN db.js
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchAdminAnalytics() {
  const ordersSnap = await getDocs(collection(db, 'orders'))
  const usersSnap = await getDocs(collection(db, 'users'))
  let totalRevenue = 0, activeOrders = 0, todayOrders = 0, todayRevenue = 0
  const monthlyRevenue = new Array(12).fill(0)
  const todayKey = new Date().toISOString().slice(0, 10)
  const productSales = new Map()
  const lowStock = []
  
  // ✨ Status Counters
  const statusCounts = {
    pending: 0, confirmed: 0, shipped: 0, delivered: 0,
    return_requested: 0, replacement_requested: 0,
    cancelled_refund_pending: 0, returned_refund_pending: 0,
    refund_requested: 0, refund_approved: 0, refund_completed: 0
  }

  ordersSnap.forEach(d => {
    const data = d.data()
    const amount = Number(data.amount) || 0
    totalRevenue += amount
    if (!['delivered', 'cancelled', 'rejected', 'refunded', 'replaced'].includes(data.shippingStatus)) activeOrders += 1
    
    // Tally exact statuses
    const status = data.shippingStatus || 'pending'
    if (statusCounts[status] !== undefined) statusCounts[status]++
    const refundStatus = data.refund_status
    if (refundStatus && statusCounts['refund_' + refundStatus] !== undefined) statusCounts['refund_' + refundStatus]++

    const date = data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt ? new Date(data.createdAt) : null
    if (date) {
      monthlyRevenue[date.getMonth()] += amount
      if (date.toISOString().slice(0, 10) === todayKey) {
        todayOrders += 1
        todayRevenue += amount
      }
    }
    ;(data.items || []).forEach(item => {
      const key = item.name || item.productId || 'Unknown product'
      productSales.set(key, (productSales.get(key) || 0) + (Number(item.quantity) || 1))
    })
  })

  const productsSnap = await getDocs(collection(db, 'products'))
  productsSnap.forEach(d => {
    const data = d.data()
    if (Number(data.stock) <= 5) lowStock.push({ id: d.id, name: data.name, stock: Number(data.stock) || 0 })
  })

  const topProduct = [...productSales.entries()].sort((a, b) => b[1] - a[1])[0] || null
  return {
    totalRevenue, activeOrders, totalUsers: usersSnap.size,
    monthlyRevenue, todayOrders, todayRevenue,
    topProduct: topProduct ? { name: topProduct[0], quantity: topProduct[1] } : null,
    lowStock,
    statusCounts // ✨ Exposing to frontend
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 💬 CUSTOMER SUPPORT & CONTACT INQUIRIES
// ─────────────────────────────────────────────────────────────────────────────

export function subscribeToSupportChats(cb, limitCount = 25) {
  const q = query(collection(db, 'supportChats'), orderBy('lastUpdated', 'desc'), limit(limitCount))
  return onSnapshot(q, cb)
}

export async function sendAdminSupportReply(targetUserId, textVal) {
  return sendSupportMessage(targetUserId, textVal, 'admin')
}

export const sendOrderMessage = async (orderId, textVal, roleType) => {
  if (!orderId || !textVal.trim()) return
  try {
    const orderRef = doc(db, 'orders', orderId)
    const orderSnap = await getDoc(orderRef)
    
    let existingMessages = []
    if (orderSnap.exists()) existingMessages = orderSnap.data().messages || []

    const newMessagePayload = {
      senderId: roleType === 'admin' ? 'admin_node' : (auth.currentUser?.uid || 'anonymous'),
      senderName: roleType === 'admin' ? 'Administration' : (auth.currentUser?.displayName || 'Buyer'),
      senderRole: roleType,
      text: textVal.trim(),
      sentAt: Date.now()
    }

    await updateDoc(orderRef, { messages: [...existingMessages, newMessagePayload] })
  } catch (error) {
    console.error('Database Layer — Chat transmission exception dropped:', error)
    throw error
  }
}

export const sendSupportMessage = async (targetUserId, textVal, roleType) => {
  if (!textVal.trim() || !targetUserId) return
  try {
    const chatRef = doc(db, 'supportChats', targetUserId)
    const chatSnap = await getDoc(chatRef)
    const newMessage = { text: textVal.trim(), role: roleType, timestamp: Date.now() }
    const payload = {
      lastUpdated: serverTimestamp(),
      messages: arrayUnion(newMessage),
    }
    if (roleType === 'user') {
      payload.userName = auth.currentUser?.displayName || 'Pahari User'
    } else if (!chatSnap.exists() || !chatSnap.data().userName) {
      payload.userName = 'Pahari User'
    }
    await setDoc(chatRef, payload, { merge: true })
  } catch (error) {
    console.error("Support Chat Error:", error)
    throw error
  }
}

export async function createContactQuery(payload) {
  const ref = await addDoc(collection(db, 'contact_queries'), {
    ...payload,
    status: 'pending',
    createdAt: serverTimestamp(),
  })

  createAuditLog('CREATE_CONTACT_QUERY', 'contact_query', ref.id, null, payload)
  return ref.id
}

export function subscribeToContactQueriesPaginated(limitCount, cb, onError) {
  const q = query(collection(db, 'contact_queries'), orderBy('createdAt', 'desc'), limit(limitCount))
  return onSnapshot(q, cb, onError)
}

export async function fetchContactQueries(limitCount = 10) {
  const q = query(collection(db, 'contact_queries'), orderBy('createdAt', 'desc'), limit(limitCount))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function updateContactQueryStatus(queryId, status) {
  const ref = doc(db, 'contact_queries', queryId)
  const oldSnap = await getDoc(ref)
  const oldData = oldSnap.exists() ? oldSnap.data() : null
  await updateDoc(ref, { status })

  await createAuditLog('UPDATE_CONTACT_QUERY_STATUS', 'contact_query', queryId, oldData, { status })
}

export async function deleteContactQuery(queryId) {
  const ref = doc(db, 'contact_queries', queryId)
  const oldSnap = await getDoc(ref)
  const oldData = oldSnap.exists() ? oldSnap.data() : null
  await deleteDoc(ref)

  await createAuditLog('DELETE_CONTACT_QUERY', 'contact_query', queryId, oldData, null)
}

// ─────────────────────────────────────────────────────────────────────────────
// ⭐ PRODUCT REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

export const fetchProductReviews = async (productId) => {
  if (!productId) return []
  try {
    const q = query(collection(db, 'reviews'), where('productId', '==', productId))
    const snap = await getDocs(q)
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  } catch (error) {
    console.error("Error pulling product reviews matrix:", error)
    return []
  }
}

export const addProductReview = async (productId, rating, comment) => {
  const currentUser = auth.currentUser
  if (!currentUser) throw new Error('NOT_LOGGED_IN')
  
  try {
    await addDoc(collection(db, 'reviews'), {
      productId,
      userId: currentUser.uid,
      userName: currentUser.displayName || 'Verified Buyer',
      rating: Number(rating),
      comment: comment.trim(),
      createdAt: serverTimestamp()
    })
  } catch (error) {
    console.error("Failed submitting user review:", error)
    throw error
  }
}

// Add this under addProductReview in db.js
export const deleteProductReview = async (reviewId) => {
  try {
    await deleteDoc(doc(db, 'reviews', reviewId))
  } catch (error) {
    console.error("Error deleting review:", error)
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⚙️ SYSTEM CONFIGURATION, SHIPPING & LOGISTICS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchGatewayConfig() {
  const now = Date.now()
  if (_gatewayConfigCache && now - _gatewayConfigCachedAt < _configCacheTtlMs) {
    return _gatewayConfigCache
  }
  const snap = await getDoc(doc(db, 'systemConfig', 'gateways'))
  _gatewayConfigCache = snap.exists() ? snap.data() : { isCodActive: true }
  _gatewayConfigCachedAt = now
  return _gatewayConfigCache
}

export const setCodStatus = async (statusActive) => {
  try {
    const configRef = doc(db, 'systemConfig', 'gateways')
    const oldSnap = await getDoc(configRef)
    const oldData = oldSnap.exists() ? oldSnap.data() : null
    const newData = { isCodActive: !!statusActive }

    await setDoc(configRef, newData, { merge: true })
    _gatewayConfigCache = null

    await createAuditLog('TOGGLE_COD', 'system_config', 'gateways', oldData, newData)
  } catch (error) {
    console.error('Database Layer — Gateway toggling runtime error:', error)
    throw error
  }
}

export async function fetchShippingConfig() {
  const now = Date.now()
  if (_shippingConfigCache && now - _shippingConfigCachedAt < _configCacheTtlMs) {
    return _shippingConfigCache
  }
  try {
    const snap = await getDoc(doc(db, 'systemConfig', 'shipping'))
    _shippingConfigCache = snap.exists() ? snap.data() : { fee: 60, freeThreshold: 499, isFreeShippingActive: true }
    _shippingConfigCachedAt = now
    return _shippingConfigCache
  } catch (e) {
    console.warn("Failed to fetch shipping config:", e.message)
    return { fee: 60, freeThreshold: 499, isFreeShippingActive: true }
  }
}

export async function updateShippingConfig(configPayload) {
  try {
    const ref = doc(db, 'systemConfig', 'shipping')
    const oldSnap = await getDoc(ref)
    const oldData = oldSnap.exists() ? oldSnap.data() : null

    await setDoc(ref, configPayload, { merge: true })
    _shippingConfigCache = null

    await createAuditLog('UPDATE_SHIPPING_CONFIG', 'systemConfig', 'shipping', oldData, configPayload)
  } catch (e) {
    console.error("Shipping config update failed:", e.message)
    throw e
  }
}


export async function fetchGlobalSettings() {
  const snap = await getDoc(doc(db, 'settings', 'global'))
  return snap.exists() ? snap.data() : {
    shippingMode: 'flat',
    shippingFlatRate: 60,
    freeShippingAbove: 499,
    taxPercent: 18,
    logoUrl: '',
    razorpayKeyMasked: '',
  }
}

export async function updateGlobalSettings(settingsPayload) {
  const actorRole = await fetchUserRole()
  if (actorRole !== 'superadmin') throw new Error('ONLY_SUPERADMIN_CAN_UPDATE_SETTINGS')
  const ref = doc(db, 'settings', 'global')
  const oldSnap = await getDoc(ref)
  const oldData = oldSnap.exists() ? oldSnap.data() : null
  await setDoc(ref, { ...settingsPayload, updatedAt: serverTimestamp() }, { merge: true })
  await createAuditLog('UPDATE_GLOBAL_SETTINGS', 'settings', 'global', oldData, settingsPayload)
}

export async function requestRazorpayKeyUpdate(keyLabel, keyValue) {
  const actorRole = await fetchUserRole()
  if (actorRole !== 'superadmin') throw new Error('ONLY_SUPERADMIN_CAN_UPDATE_PAYMENT_KEYS')
  if (!keyLabel?.trim() || !keyValue?.trim()) throw new Error('PAYMENT_KEY_REQUIRED')
  return createAdminTask('UPDATE_RAZORPAY_KEY', { keyLabel: keyLabel.trim(), keyValue: keyValue.trim() }, 'settings', 'global')
}

// ─────────────────────────────────────────────────────────────────────────────
// 🎟️ COUPONS MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const fetchCoupons = async () => {
  try {
    const snap = await getDocs(collection(db, 'coupons'))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (error) {
    console.error('Database Layer — Failed pulling coupons matrix:', error)
    return []
  }
}

export const saveCoupons = async (couponList) => {
  try {
    for (const coupon of couponList) {
      if (!coupon.code) continue
      const code = coupon.code.toUpperCase()
      const docRef = doc(db, 'coupons', code)
      const oldSnap = await getDoc(docRef)
      const oldData = oldSnap.exists() ? oldSnap.data() : null

      const payload = {
        code,
        discount: Number(coupon.discount) || 0,
        type: coupon.type || 'percent',
        minOrderAmount: Number(coupon.minOrderAmount) || 0,
        minItems: Number(coupon.minItems) || 0,
        expiresAt: coupon.expiresAt || null,
        maxUses: Number(coupon.maxUses) || 0,
        usageCount: Number(coupon.usageCount) || 0,
        active: coupon.active ?? true,
        updatedAt: serverTimestamp()
      }

      await setDoc(docRef, payload, { merge: true })

      await createAuditLog(oldData ? 'UPDATE_COUPON' : 'CREATE_COUPON', 'coupon', code, oldData, payload)
    }
  } catch (error) {
    console.error('Database Layer — Coupon serialization runtime error:', error)
    throw error
  }
}

export const deleteCouponFromDb = async (couponCode) => {
  if (!couponCode) return
  try {
    const code = couponCode.toUpperCase()
    const docRef = doc(db, 'coupons', code)
    const oldSnap = await getDoc(docRef)
    const oldData = oldSnap.exists() ? oldSnap.data() : null

    await deleteDoc(docRef)

    await createAuditLog('DELETE_COUPON', 'coupon', code, oldData, null)
  } catch (error) {
    console.error('Database Layer — Failed to delete coupon document:', error)
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 📜 AUDIT LOGGING
// ─────────────────────────────────────────────────────────────────────────────

export async function createAuditLog(action, entityType, entityId, oldData = null, newData = null) {
  try {
    const currentUser = auth.currentUser
    let role = 'unknown'

    if (currentUser) {
      const snap = await getDoc(doc(db, 'users', currentUser.uid))
      role = snap.exists() ? (snap.data().role || 'user') : 'user'
    }

    await addDoc(collection(db, 'audit_logs'), {
      action, entityType, entityId, oldData, newData,
      performedByUid: currentUser?.uid || null,
      performedByEmail: currentUser?.email || null,
      performedByRole: role,
      createdAt: serverTimestamp(),
    })
  } catch (e) {
    console.error('createAuditLog failed:', e)
  }
}

export async function fetchAuditLogs() {
  try {
    const snap = await getDocs(collection(db, 'audit_logs'))
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    rows.sort((a, b) => {
      const at = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0
      const bt = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0
      return bt - at
    })
    return rows
  } catch (e) {
    console.error('fetchAuditLogs failed:', e)
    return []
  }
}

// Legacy passthrough event log (Deprecated but kept for backwards compatibility)
export async function logAudit(action, details = {}) {
  const user = auth.currentUser
  await addDoc(collection(db, 'audit_logs'), {
    action, details,
    performedByUid: user?.uid || null,
    performedByEmail: user?.email || null,
    createdAt: serverTimestamp()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 🏔️ LANDING PAGE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch landing page configuration from Firestore
 * Config is stored in 'landingConfig' collection with docId 'main'
 */
export async function fetchLandingConfig() {
  try {
    const snap = await getDoc(doc(db, 'landingConfig', 'main'))
    if (snap.exists()) {
      return snap.data()
    }
    // Return default config matching landing.vue structure
    return getDefaultLandingConfig()
  } catch (e) {
    console.error('fetchLandingConfig error:', e)
    return getDefaultLandingConfig()
  }
}

/**
 * Default landing configuration matching landing.vue hardcoded values
 */
function getDefaultLandingConfig() {
  return {
    cards: [
      {
        id: 'c1',
        style: 'distort',
        size: 'lg',
        label: 'Liquid Distort',
        image: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Ffounder.jpg?alt=media&token=afb61aba-bbba-4974-a4d2-4416332d01db',
        imgOffsetX: 0,
        imgOffsetY: 0,
        imgScale: 1.05,
        rotation: -6,
        initialZ: 3
      },
      {
        id: 'c2',
        style: 'distort',
        size: 'sm',
        label: 'Liquid Distort',
        image: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fvillage.jpg?alt=media&token=87f75b78-6bc9-40b0-965a-09efd60260d4',
        imgOffsetX: 0,
        imgOffsetY: 0,
        imgScale: 1.1,
        rotation: 4,
        initialZ: 2
      },
      {
        id: 'c3',
        style: 'specular',
        size: 'md',
        label: 'Specular Glass',
        image: 'https://images.unsplash.com/photo-1556881286-fc6915169721?w=400&h=400&fit=crop',
        imgOffsetX: 0,
        imgOffsetY: 0,
        imgScale: 1.1,
        rotation: -3,
        initialZ: 5
      },
      {
        id: 'c4',
        style: 'specular',
        size: 'sm',
        label: 'Specular Glass',
        image: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fhero2.jpg?alt=media&token=ff12c12e-3078-411a-bc76-f36b6928eaf1',
        imgOffsetX: 0,
        imgOffsetY: 0,
        imgScale: 1.1,
        rotation: 7,
        initialZ: 4
      },
      {
        id: 'c5',
        style: 'frosted',
        size: 'md',
        label: 'Simple Frosted',
        image: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fvillage-women.jpg?alt=media&token=2b210d97-e255-499f-a4ab-98f6f67da6bc',
        imgOffsetX: 0,
        imgOffsetY: 0,
        imgScale: 1.1,
        rotation: -8,
        initialZ: 1
      },
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
    ],
    updatedAt: null
  }
}

/**
 * Save landing page configuration to Firestore
 */
export async function saveLandingConfig(config) {
  try {
    const payload = {
      ...config,
      updatedAt: serverTimestamp()
    }
    await setDoc(doc(db, 'landingConfig', 'main'), payload, { merge: true })
    return { success: true }
  } catch (e) {
    console.error('saveLandingConfig error:', e)
    return { success: false, error: e.message }
  }
}

/**
 * Upload landing page image to Firebase Storage
 * @param {File} file - Image file to upload
 * @param {string} cardId - Card identifier (c1-c5) or 'scattered'
 * @returns {Promise<string>} - Download URL
 */
export async function uploadLandingImage(file, cardId) {
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1600,
    useWebWorker: true
  }
  const compressedFile = await imageCompression(file, options)
  const fileExt = file.name.split('.').pop()
  const filePath = `landing/${cardId}/${Date.now()}_${Math.floor(Math.random() * 1000)}.${fileExt}`

  const imageRef = storageRef(storage, filePath)
  await uploadBytes(imageRef, compressedFile)
  return await getDownloadURL(imageRef)
}

/**
 * Delete landing image from Storage
 */
export async function deleteLandingImage(fileUrl) {
  if (!fileUrl || !fileUrl.includes('firebasestorage.googleapis.com')) return
  try {
    const fileRef = storageRef(storage, fileUrl)
    await deleteObject(fileRef)
  } catch (e) {
    console.warn('deleteLandingImage failed:', e.message)
  }
}



/**
 * Default About Page configuration matching about.vue structure
 */
function getDefaultAboutConfig() {
  return {
    images: {
      hero: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fhero2.jpg?alt=media&token=ff12c12e-3078-411a-bc76-f36b6928eaf1',
      village: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fvillage-women.jpg?alt=media&token=2b210d97-e255-499f-a4ab-98f6f67da6bc',
      family: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Fvillage.jpg?alt=media&token=87f75b78-6bc9-40b0-a4ab-98f6f67da6bc',
      valley: 'https://images.pexels.com/photos/3057904/pexels-photo-3057904.jpeg',
      founder: 'https://firebasestorage.googleapis.com/v0/b/pahadse-13309.firebasestorage.app/o/contact%2Ffounder.jpg?alt=media&token=afb61aba-bbba-4974-a4d2-4416332d01db'
    },
    text: {
      heroTitle: 'Life in the Himalayas',
      heroSubtitle: 'Seedha Pahadon Se: Shuddh, Pahari, Asli',
      section1Title: 'The Mountain Way of Life',
      section1Body: 'The Himalayan region is known for its pristine environment, traditional lifestyles, and rich agricultural heritage. For us, the mountains are not just where we live—they are the very essence of who we are.\n\nDaily life here is dictated by the rhythm of changing seasons, the flow of natural springs, and a profound connection to the land. In our households, ancient methods of preparing food are not just remembered; they are actively practiced. These traditions, passed down through generations, are the soul of every product we bring to your table.',
      section2Title: 'Bridging Communities to You',
      section2Body: '<strong>PahadS</strong> is more than a storefront; it is a bridge connecting you directly to the authentic mountain families of Himachal Pradesh. We don\'t own large farms — instead, we work with and support multiple small-scale producers across Seraj Valley.\n\nWe collect pure Bilona ghee, traditional oils, raw spices, and forest honey from local families who have perfected their craft over generations. Our role is to bring their honest, traditional products to customers who appreciate authenticity.\n\n<ul class="mission-list">\n  <li><strong>Support Local Families:</strong> We source from 25+ households across the valley, not just one farm.</li>\n  <li><strong>Fair Value:</strong> By eliminating middlemen, fair prices reach the actual producers.</li>\n  <li><strong>Preserve Heritage:</strong> Every purchase helps sustain traditional knowledge and skills.</li>\n  <li><strong>Authentic Products:</strong> What you receive is exactly what the mountain families prepared.</li>\n</ul>\nWe are simply the messenger. The real heroes are the mountain families who wake up before sunrise, tend to their livestock, harvest wild forest produce, and prepare food the way their ancestors did.',
      founderTitle: 'Meet Our Founder',
      founderBody: '<strong>Bhawani Dutt</strong> was born and raised in the heart of Himachal Pradesh, surrounded by the very mountains and communities that PahadS now serves.\n\nAfter spending years in the corporate world, he realized that the traditional knowledge of his homeland was slowly fading away. The younger generation was moving to cities, and the ancient practices of making pure Bilona ghee, cold-pressed oils, and forest honey were being replaced by mass-produced alternatives.\n\nThat\'s when he decided to return to his roots. PahadS was born not as a business, but as a mission — to bridge the gap between authentic mountain producers and conscious consumers.\n\n<em>"I don\'t own farms or produce everything myself. What I do have is deep respect for the mountain families I grew up around. PahadS is my effort to bring their honest work to people who will appreciate it."</em>',
      founderQuote: 'I don\'t own farms or produce everything myself. What I do have is deep respect for the mountain families I grew up around. PahadS is my effort to bring their honest work to people who will appreciate it. Every order means one more family in these hills gets fair value for their traditional skills.',
      founderName: 'Bhawani Dutt',
      communityText: 'From this small valley, we coordinate with local families who produce traditional goods using methods passed down for generations. We don\'t own farms — we partner with families who do.',
      thankYouTitle: 'Thank You',
      thankYouBody: 'Thank you for visiting PahadS.\n\nYour support helps preserve traditional knowledge, supports multiple families across Himachal Pradesh, and encourages us to continue bridging the gap between authentic mountain producers and conscious customers like you.\n\nWe look forward to serving you.'
    }
  }
}

/**
 * Save About Page Configuration
 */
export async function saveAboutConfig(config) {
  try {
    await setDoc(doc(db, 'aboutConfig', 'main'), config, { merge: true })
    return { success: true }
  } catch (e) {
    console.error('saveAboutConfig error:', e)
    return { success: false, error: e.message }
  }
}

/**
 * Upload About Page image to Firebase Storage
 */
export async function uploadAboutImage(file, imageKey) {
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1600,
    useWebWorker: true
  }
  const compressedFile = await imageCompression(file, options)
  const fileExt = file.name.split('.').pop()
  const filePath = `about/${imageKey}/${Date.now()}_${Math.floor(Math.random() * 1000)}.${fileExt}`

  const imageRef = storageRef(storage, filePath)
  await uploadBytes(imageRef, compressedFile)
  return await getDownloadURL(imageRef)
}

/**
 * Delete About Page image from Storage
 */
export async function deleteAboutImage(fileUrl) {
  if (!fileUrl || !fileUrl.includes('firebasestorage.googleapis.com')) return
  try {
    const fileRef = storageRef(storage, fileUrl)
    await deleteObject(fileRef)
  } catch (e) {
    console.warn('deleteAboutImage failed:', e.message)
  }
}
