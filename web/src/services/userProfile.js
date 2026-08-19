import { supabase } from './supabase'

let _cached = null
let _cacheTime = 0

export async function getUserContext(forceRefresh = false) {
  const now = Date.now()
  if (_cached && !forceRefresh && (now - _cacheTime) < 30000) return _cached
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}
  const meta = user.user_metadata || {}
  _cached = {
    email:    user.email,
    sheet_id: meta.sheet_id || null,
    sender: {
      name:         meta.full_name    || '',
      mobile:       meta.mobile       || '',
      organisation: meta.organisation || '',
      role:         meta.role         || '',
    }
  }
  _cacheTime = now
  return _cached
}

export function clearUserContextCache() { _cached = null; _cacheTime = 0 }
