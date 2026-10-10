import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('../views/LoginView.vue'), meta: { public: true, title: '登录' } },
    {
      path: '/',
      component: () => import('../layout/AppLayout.vue'),
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          component: () => import('../views/DashboardView.vue'),
          meta: { title: '首页', shopFilter: true },
        },
        {
          path: 'expenses',
          component: () => import('../views/ExpenseListView.vue'),
          meta: { title: '费用', shopFilter: true },
        },
        {
          path: 'expenses/new',
          component: () => import('../views/ExpenseFormView.vue'),
          meta: { title: '新增费用' },
        },
        {
          path: 'expenses/:id/edit',
          component: () => import('../views/ExpenseFormView.vue'),
          meta: { title: '编辑费用' },
        },
        {
          path: 'expenses/:id',
          component: () => import('../views/ExpenseDetailView.vue'),
          meta: { title: '费用详情' },
        },
        {
          path: 'payroll',
          component: () => import('../views/payroll/PayrollMembersView.vue'),
          meta: { title: '工资' },
        },
        {
          path: 'payroll/:id',
          component: () => import('../views/payroll/PayrollCalendarView.vue'),
          meta: { title: '工资 · 月历' },
        },
        {
          path: 'reports',
          component: () => import('../views/ReportsView.vue'),
          meta: { title: '报表', shopFilter: true },
        },
        {
          path: 'settings',
          redirect: '/settings/shops',
        },
        {
          path: 'settings/shops',
          component: () => import('../views/settings/ShopsView.vue'),
          meta: { title: '设置 · 店铺' },
        },
        {
          path: 'settings/categories',
          component: () => import('../views/settings/CategoriesView.vue'),
          meta: { title: '设置 · 类别' },
        },
        {
          path: 'settings/users',
          component: () => import('../views/settings/UsersView.vue'),
          meta: { title: '设置 · 成员' },
        },
        {
          path: 'settings/profile',
          component: () => import('../views/settings/ProfileView.vue'),
          meta: { title: '设置 · 资料' },
        },
        {
          path: 'settings/backup',
          component: () => import('../views/settings/BackupView.vue'),
          meta: { title: '设置 · 备份' },
        },
      ],
    },
    {
      path: '/reports/print',
      component: () => import('../views/ReportPrintView.vue'),
      meta: { title: '打印报表', print: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

// Keep the shop while moving between pages; each page's other filters stay local.
let currentShop: string | undefined

router.beforeEach(async (to, from) => {
  const auth = useAuthStore()
  if (to.meta.public) {
    if (auth.user && to.path === '/login') return '/dashboard'
    return true
  }
  if (!auth.ready) {
    await auth.fetchMe()
  }
  if (!auth.user) {
    return { path: '/login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } }
  }
  if (auth.user.must_change_password && to.path !== '/settings/profile') {
    return '/settings/profile'
  }
  if (to.meta.shopFilter && to.path !== from.path && !Object.hasOwn(to.query, 'shop') && currentShop) {
    return { path: to.path, query: { ...to.query, shop: currentShop }, hash: to.hash }
  }
  return true
})

router.afterEach((to, _from, failure) => {
  if (failure) return
  if (to.path === '/login') currentShop = undefined
  else if (to.meta.shopFilter) {
    currentShop = typeof to.query.shop === 'string' && to.query.shop ? to.query.shop : undefined
  }
  document.title = (to.meta.title as string | undefined) ?? '家庭费用管理'
})

export default router
