import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.existsSync('.env.local') ? '.env.local' : '.env';
const content = fs.readFileSync(envFile, 'utf8');
const env = {};
for (const line of content.split('\n')) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (match) {
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: drives, error } = await supabase
  .from('drives')
  .select('id, company_name, role_title, status, published_at')
  .in('status', ['live', 'approved'])
  .order('published_at', { ascending: false });

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

console.log('Recent drives (live/approved):');
console.log(JSON.stringify(drives, null, 2));

// Check if any notifications exist for these drives
const driveIds = drives.map(d => d.id);
const { data: notifications, error: notifError } = await supabase
  .from('notifications')
  .select('id, student_id, kind, title, drive_id, created_at')
  .in('drive_id', driveIds)
  .order('created_at', { ascending: false });

if (notifError) {
  console.error('Notification error:', notifError);
} else {
  console.log('\nNotifications for these drives:');
  console.log(`Total: ${notifications?.length || 0}`);
  if (notifications && notifications.length > 0) {
    console.log(JSON.stringify(notifications.slice(0, 10), null, 2));
  }
}
