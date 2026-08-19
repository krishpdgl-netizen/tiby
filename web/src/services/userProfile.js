/**
 * Get current user's profile and sheet ID from Supabase session.
 * Used to personalise email drafts and route data to the right sheet.
 */
import { supabase } from './supabase'

export async function getUserContext() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}
  const meta = user.user_metadata || {}
  return {
    email:      user.email,
    sheet_id:   meta.sheet_id   || null,
    sender: {
      name:         meta.full_name    || '',
      mobile:       meta.mobile       || '',
      organisation: meta.organisation || '',
      role:         meta.role         || '',
    }
  }
}
