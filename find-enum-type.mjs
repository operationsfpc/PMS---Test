import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.existsSync('.env.local') ? '.env.local' : '.env';
const content = fs.readFileSync(envFile, 'utf8');
const env = {};
for (const line of content.split('\n')) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function find() {
  // Query the column type directly
  const { data, error } = await supabase
    .from('drives')
    .select('arrears_policy')
    .limit(1);
  
  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Column exists. Checking enum type...');
  
  // Try to get enum values via raw query
  const { data: enums, error: enumError } = await supabase.rpc('get_enum_values', { enum_name: 'arrears_policy' });
  
  if (enumError) {
    console.log('RPC failed, trying alternatives...');
    
    // Check if it's actually stored as text
    const { data: sample } = await supabase
      .from('drives')
      .select('arrears_policy')
      .limit(10);
    
    console.log('Sample values:', sample);
  } else {
    console.log('Enum values:', enums);
  }
}

find().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
