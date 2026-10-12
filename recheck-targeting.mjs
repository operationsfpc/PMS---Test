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
  const driveId = 'f5d497bd-d7e8-40c7-9dfb-38e557ed881b';
  
  // Get all targeted campuses with names
  const { data: targetCampuses } = await supabase
    .from('drive_target_campuses')
    .select('campus_id')
    .eq('drive_id', driveId);
  
  console.log(`Targeted campus IDs: ${targetCampuses?.length || 0}`);
  
  // Get SDNB campus ID
  const { data: sdnb } = await supabase
    .from('campuses')
    .select('id, name')
    .ilike('name', '%SDNB%')
    .single();
  
  console.log(`\nSDNB Campus:`);
  console.log(`  Name: ${sdnb?.name}`);
  console.log(`  ID: ${sdnb?.id}`);
  
  const isTargeted = targetCampuses?.some(tc => tc.campus_id === sdnb?.id);
  console.log(`  In drive_target_campuses: ${isTargeted ? 'YES' : 'NO'}`);
  
  // List all targeted campus names
  if (targetCampuses?.length > 0) {
    const { data: campusNames } = await supabase
      .from('campuses')
      .select('id, name')
      .in('id', targetCampuses.map(tc => tc.campus_id));
    
    console.log(`\nAll targeted campuses (${campusNames?.length || 0}):`);
    campusNames?.forEach(c => {
      const isSdnb = c.id === sdnb?.id ? ' <-- SDNB' : '';
      console.log(`  - ${c.name}${isSdnb}`);
    });
  }
}

check().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
