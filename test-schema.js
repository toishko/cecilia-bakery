require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://dykztphptnytbihpavpa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a3p0cGhwdG55dGJpaHBhdnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTY4NzksImV4cCI6MjA4OTQ3Mjg3OX0.jinnkmJj5tjYmMXPEx0FsbE8qHKU2j6kvv5HyczWr4w';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
async function check() {
  const { data, error } = await sb.rpc('exec_sql', { sql: 'SELECT constraint_name, table_name FROM information_schema.table_constraints WHERE table_name = \'driver_inventory\';' });
  console.log(data, error);
}
check();
