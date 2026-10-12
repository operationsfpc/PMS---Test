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

const driveIds = [
  '2140b734-724d-406f-8c88-95e61c975e4f',
  '56cb8b6f-d720-45ea-b8a9-dc969c1bc2ae',
  '412c82e1-36b6-4bb1-8796-2762144ca3d5'
];

const { data, error, count } = await supabase
  .from('notifications')
  .select('*', { count: 'exact', head: true })
  .in('drive_id', driveIds)
  .eq('kind', 'drive_published');

if (error) {
  console.error('Error:', error);
} else {
  console.log(`Total drive_published notifications: ${count}`);
}

// Check per drive
for (const driveId of driveIds) {
  const { count: driveCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('drive_id', driveId)
    .eq('kind', 'drive_published');
  
  console.log(`Drive ${driveId}: ${driveCount} notifications`);
}

// Check email deliveries
const { count: emailCount } = await supabase
  .from('email_deliveries')
  .select('*', { count: 'exact', head: true })
  .in('notification_id', (await supabase
    .from('notifications')
    .select('id')
    .in('drive_id', driveIds)
    .eq('kind', 'drive_published')
  ).data.map(n => n.id));

console.log(`\nEmail deliveries queued: ${emailCount}`);
