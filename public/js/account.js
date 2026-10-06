import { api, currentUser, resetUser, migrateLocal } from './store.js'

const $ = (id) => document.getElementById(id)
let mode = 'in'

function setMode(m) {
  mode = m
  $('tab-in').setAttribute('aria-selected', String(m === 'in'))
  $('tab-up').setAttribute('aria-selected', String(m === 'up'))
  $('submit').textContent = m === 'in' ? 'Sign in' : 'Create account'
  $('pw-hint').hidden = m === 'in'
  $('password').autocomplete = m === 'in' ? 'current-password' : 'new-password'
  $('form-error').hidden = true
}

async function render() {
  const user = await currentUser()
  $('signed-out').hidden = !!user
  $('signed-in').hidden = !user
  $('danger').hidden = !user
  if (user) $('who').textContent = user.email
}

$('tab-in').addEventListener('click', () => setMode('in'))
$('tab-up').addEventListener('click', () => setMode('up'))

$('form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const err = $('form-error')
  err.hidden = true
  const email = $('email').value.trim()
  const password = $('password').value
  if (!email || !password) {
    err.textContent = 'Enter your email and password.'
    err.hidden = false
    return
  }
  $('submit').disabled = true
  try {
    await api(mode === 'in' ? '/auth/signin' : '/auth/signup', { method: 'POST', body: { email, password } })
    resetUser()
    await migrateLocal().catch(() => {})
    location.href = '/history'
  } catch (ex) {
    err.textContent = ex.message
    err.hidden = false
  } finally {
    $('submit').disabled = false
  }
})

$('signout').addEventListener('click', async () => {
  await api('/auth/signout', { method: 'POST', body: {} })
  resetUser()
  location.href = '/'
})

$('delete-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const err = $('delete-error')
  err.hidden = true
  const password = $('delete-password').value
  if (!password) {
    err.textContent = 'Enter your password to confirm.'
    err.hidden = false
    return
  }
  if (!confirm('Delete your account and all saved results permanently?')) return
  $('delete-btn').disabled = true
  try {
    await api('/auth/delete-account', { method: 'POST', body: { password } })
    resetUser()
    location.href = '/'
  } catch (ex) {
    err.textContent = ex.message
    err.hidden = false
  } finally {
    $('delete-btn').disabled = false
  }
})

setMode('in')
render()
