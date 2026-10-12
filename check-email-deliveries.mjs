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

// Get notification IDs for drive_published
const { data: notifications } = await supabase
  .from('notifications')
  .select('id')
  .eq('kind', 'drive_published');

console.log(`Found ${notifications?.length || 0} drive_published notifications`);

if (notifications && notifications.length > 0) {
  const notifIds = notifications.map(n => n.id);
  
  // Check email deliveries
  const { data: deliveries, error } = await supabase
    .from('email_deliveries')
    .select('id, status, recipient_email')
    .in('notification_id', notifIds)
    .limit(10);
  
  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`\nSample email deliveries (first 10):`);
    console.log(JSON.stringify(deliveries, null, 2));
  }
  
  // Count by status
  const { count: queuedCount } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .in('notification_id', notifIds)
    .eq('status', 'queued');
  
  const { count: sentCount } = await supabase
    .from('email_deliveries')
    .select('*', { count: 'exact', head: true })
    .in('notification_id', notifIds)
    .eq('status', 'sent');
  
  console.log(`\nQueued: ${queuedCount}`);
  console.log(`Sent: ${sentCount}`);
}
