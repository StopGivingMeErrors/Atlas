import { createClient } from '@supabase/supabase-js';

const supabaseUrl = '***REMOVED***';
const supabaseAnonKey ='***REMOVED***';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL or Anon Key is not defined')
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)


// console.log(supabaseUrl)
// console.log(supabaseAnonKey)

export default supabase;