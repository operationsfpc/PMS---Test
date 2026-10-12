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
  // Get the drive from the screenshot URL
  const driveId = 'f5d497bd-d7e8-40c7-9dfb-38e557ed881b';
  
  const { data: drive } = await supabase
    .from('drives')
    .select('*')
    .eq('id', driveId)
    .single();
  
  console.log('=== DRIVE DETAILS ===');
  console.log(`Company: ${drive?.company_name}`);
  console.log(`Status: ${drive?.status}`);
  console.log(`Arrears policy: ${drive?.arrears_policy}`);
  
  // Check campus targeting
  const { data: targetCampuses } = await supabase
    .from('drive_target_campuses')
    .select('campus_id, campuses:campus_id(name)')
    .eq('drive_id', driveId);
  
  console.log('\n=== TARGETED CAMPUSES ===');
  console.log(`Count: ${targetCampuses?.length || 0}`);
  targetCampuses?.forEach(tc => {
    console.log(`  - ${tc.campuses?.name || tc.campus_id}`);
  });
  
  // Check if SDNB is in the list
  const { data: sdnbCampus } = await supabase
    .from('campuses')
    .select('id, name')
    .ilike('name', '%SDNB%')
    .single();
  
  console.log('\n=== SDNB CAMPUS ===');
  console.log(`Found: ${sdnbCampus?.name || 'NOT FOUND'}`);
  console.log(`ID: ${sdnbCampus?.id}`);
  
  const sdnbTargeted = targetCampuses?.some(tc => tc.campus_id === sdnbCampus?.id);
  console.log(`SDNB targeted: ${sdnbTargeted ? 'YES' : 'NO'}`);
  
  // Check SDNB students
  const { count: sdnbStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('campus_id', sdnbCampus?.id);
  
  console.log(`\nSDNB students: ${sdnbStudents || 0}`);
  
  // Check if SDNB students have notifications for this drive
  if (sdnbCampus) {
    const { data: sdnbNotifs } = await supabase
      .from('notifications')
      .select('id, student_id, kind')
      .eq('drive_id', driveId)
      .limit(5);
    
    console.log(`\nNotifications for this drive: ${sdnbNotifs?.length || 0}`);
    
    // Check if any SDNB students got notifications
    const { data: sdnbStudentsWithNotifs } = await supabase
      .from('students')
      .select('id, full_name')
      .eq('campus_id', sdnbCampus.id)
      .in('id', (sdnbNotifs || []).map(n => n.student_id));
    
    console.log(`SDNB students with notifications: ${sdnbStudentsWithNotifs?.length || 0}`);
  }
}

check().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
