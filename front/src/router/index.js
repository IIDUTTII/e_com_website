import { createRouter, createWebHistory } from 'vue-router'
import { isAdmin, isSuperAdmin, authPromise } from '../userAuth.js'

import Landing     from '../components/landing.vue'
import Home          from '../components/home.vue'
import Admin         from '../components/admin/dashboard.vue'
import Login         from '../components/login.vue'
import Register      from '../components/register.vue'
import User          from '../components/user.vue'
import NotFoundView  from '../components/NotFoundView.vue'
import Privacy        from '../components/PolicyView.vue'
import Cart          from '../components/cartview.vue'
import ProductDetail from '../components/ProductDetail.vue'   
import ProductForm from '../components/productedit.vue'
import checkout from '../components/checkout.vue'
import Terms from '../components/terms.vue'
import Return  from '../components/return-refund.vue'  
import Contact from '../components/contact.vue'
import About from '../components/about.vue'
import orders from '../components/orders.vue'
//import Layout from '../components/layout.vue'


const routes = [
  { path: '/',                       component:   Landing,name: "Landing",meta: { title: 'PahadS' }          },
  { path: '/products',              component:   Home,name: "Home",meta: { title: 'Home | PahadS' }          },
  { path: '/login',                  component: Login,name: "Login",meta: { title: 'Login | PahadS' }         },
  { path: '/register',               component: Register,name: "Register",meta: { title: 'Register | PahadS' }      },
  { path: '/user',                   component: User,name: "User",meta: { title: 'User | PahadS' }          },
  { path: '/privacy',               component: Privacy,name: "Privacy",meta: { title: 'Privacy | PahadS' }       },
  { path: '/cart',                   component: Cart,name: "Cart",meta: { title: 'Cart | PahadS' }          },
  { path: '/product/:id',            component: ProductDetail,name: "ProductDetail",meta: { title: 'Product | PahadS' } },
  { path: '/admin', component: Admin, meta: { title: 'Admin | PahadS', requiresAdmin: true } },
  { path: '/admin/product/:id', component: ProductForm, meta: { title: 'Edit Product | PahadS', requiresAdmin: true } },
  { path: '/admin/product/new', component: ProductForm, meta: { title: 'New Product | PahadS', requiresAdmin: true } },
  { path: '/checkout', component: checkout,meta: { title: 'Checkout | PahadS' } },
  { path: '/terms', component: Terms,meta: { title: 'Terms | PahadS' } },
  { path: '/return', component: Return,meta: { title: 'Return & Refund | PahadS' } },
  { path: '/contact', component: Contact,meta: { title: 'Contact | PahadS' } },
  { path: '/about', component: About,meta: { title: 'About | PahadS' } },
  { path: '/orders', component: orders,meta: { title: 'Orders | PahadS' } },
  { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFoundView },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // If coming back via back/forward, restore position
    if (savedPosition) {
      return savedPosition
    }
    // If there's a hash (e.g., /page#section), scroll to it
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth', top: 70 }
    }
    // Default: scroll to top
    return { top: 0, left: 0, behavior: 'smooth' }
  }
})

// ── Fixed: return value instead of next() — removes the deprecated warning
router.beforeEach(async (to, from) => {
  await authPromise   // wait for auth to be ready (only blocks on first load)

  if (to.meta.requiresAdmin) {
    if (isAdmin.value || isSuperAdmin.value) {
      return true          // ✅ allow
    } else {
      alert('app admin nahi ho')  // 🚫 block
      return '/'           // ✅ redirect — replaces next('/')
    }
  }

  return true              // ✅ allow all other routes — replaces next()
})

export default router