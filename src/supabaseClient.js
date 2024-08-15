import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://awslquqwfzpqxizeghjk.supabase.co';
const supabaseAnonKey ='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3c2xxdXF3ZnpwcXhpemVnaGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMzMjkwNDYsImV4cCI6MjAzODkwNTA0Nn0.18xDG1gK2gqMqByxPuZKN8QInDn14fOOUUPhfBtX4HU';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL or Anon Key is not defined')
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)


// console.log(supabaseUrl)
// console.log(supabaseAnonKey)

export default supabase;