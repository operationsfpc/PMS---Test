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

async function getEnums() {
  // Query all enum types from the database
  const { data, error } = await supabase.rpc('get_all_enums');
  
  if (error) {
    console.log('RPC not available, trying alternative...');
    
    // Get all columns that might be enums from drives table
    const { data: drives } = await supabase
      .from('drives')
      .select('*')
      .limit(1);
    
    console.log('\nDrives table columns:');
    if (drives && drives[0]) {
      for (const [key, value] of Object.entries(drives[0])) {
        console.log(`  ${key}: ${typeof value} = ${value}`);
      }
    }
    
    // Get students table
    const { data: students } = await supabase
      .from('students')
      .select('*')
      .limit(1);
    
    console.log('\nStudents table columns:');
    if (students && students[0]) {
      for (const [key, value] of Object.entries(students[0])) {
        console.log(`  ${key}: ${typeof value} = ${value}`);
      }
    }
    
    return;
  }
  
  console.log('All enum types:');
  console.log(JSON.stringify(data, null, 2));
}

getEnums().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
