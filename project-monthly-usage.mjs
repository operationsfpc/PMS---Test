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

async function project() {
  const { count: students } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true });

  const { count: drives } = await supabase
    .from('drives')
    .select('*', { count: 'exact', head: true });

  const { data: notifications } = await supabase
    .from('notifications')
    .select('kind');

  const notifCounts = {};
  notifications?.forEach(n => {
    notifCounts[n.kind] = (notifCounts[n.kind] || 0) + 1;
  });

  console.log('Current notification breakdown:');
  for (const [kind, count] of Object.entries(notifCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }

  return { students, drives, notifCounts };
}

project().then(data => {
  console.log('\n=== DATA ===');
  console.log(JSON.stringify(data, null, 2));
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
