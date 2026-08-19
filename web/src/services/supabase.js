import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON    = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase  = createClient(SUPABASE_URL, SUPABASE_ANON)

export async function getSession()     { return supabase.auth.getSession() }
export async function getGmailToken()  { const { data: { session } } = await supabase.auth.getSession(); return session?.provider_token || null }
export async function signOut()        { await supabase.auth.signOut(); window.location.reload() }
