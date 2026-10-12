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

async function check() {
  const { data: drives, error } = await supabase
    .from('drives')
    .select('id, company_name, arrears_policy');
  
  if (error) {
    console.error('Error:', error);
    return;
  }

  const uniqueValues = [...new Set(drives?.map(d => d.arrears_policy))];
  console.log('Current arrears_policy values in database:');
  uniqueValues.forEach(v => console.log(`  - "${v}"`));
  
  console.log(`\nTotal drives: ${drives?.length}`);
}

check().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
