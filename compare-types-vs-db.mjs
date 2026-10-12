const SUPABASE_URL = 'https://apzsuclpydjkmaffppmr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwenN1Y2xweWRqa21hZmZwcG1yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODE2MTY3OCwiZXhwIjoyMTAzNzM3Njc4fQ.CQYy1IAXGnh-jyqnmwgAB8GQXJ4XE8npl5SUPtuWjeQ';

console.log('=== COMPARING TYPESCRIPT TYPES vs LIVE DB ===\n');

// Get actual column names from database for key tables
const tables = ['drives', 'students', 'notifications', 'email_deliveries', 'applications', 'attendance'];

for (const table of tables) {
  console.log(`\n--- ${table.toUpperCase()} ---`);
  
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`
    }
  });
  
  if (response.ok) {
    const data = await response.json();
    if (data.length > 0) {
      const dbColumns = Object.keys(data[0]).sort();
      console.log(`DB columns (${dbColumns.length}): ${dbColumns.join(', ')}`);
    } else {
      console.log('No data in table');
    }
  } else {
    console.log(`Error: ${response.statusText}`);
  }
}

// Check enum values in use
console.log('\n\n=== ENUM VALUES IN USE ===\n');

// Students table enums
const studentsResponse = await fetch(`${SUPABASE_URL}/rest/v1/students?select=srf_status,participation_status,programme_level,tenth_board,twelfth_board,diploma_marks_scale,ug_aggregate_scale`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (studentsResponse.ok) {
  const students = await studentsResponse.json();
  
  const srfStatuses = [...new Set(students.map(s => s.srf_status).filter(Boolean))];
  const partStatuses = [...new Set(students.map(s => s.participation_status).filter(Boolean))];
  const progLevels = [...new Set(students.map(s => s.programme_level).filter(Boolean))];
  const tenthBoards = [...new Set(students.map(s => s.tenth_board).filter(Boolean))];
  const twelfthBoards = [...new Set(students.map(s => s.twelfth_board).filter(Boolean))];
  
  console.log('srf_status values:', srfStatuses.sort());
  console.log('participation_status values:', partStatuses.sort());
  console.log('programme_level values:', progLevels.sort());
  console.log('tenth_board values:', tenthBoards.sort());
  console.log('twelfth_board values:', twelfthBoards.sort());
}

// Drives table enums
const drivesResponse = await fetch(`${SUPABASE_URL}/rest/v1/drives?select=arrears_policy,drive_mode,drive_type,offer_category,status,role_category,min_overall_cgpa_scale,joining_timeline`, {
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`
  }
});

if (drivesResponse.ok) {
  const drives = await drivesResponse.json();
  
  const arrearsPolicies = [...new Set(drives.map(d => d.arrears_policy).filter(Boolean))];
  const driveModes = [...new Set(drives.map(d => d.drive_mode).filter(Boolean))];
  const driveTypes = [...new Set(drives.map(d => d.drive_type).filter(Boolean))];
  const offerCategories = [...new Set(drives.map(d => d.offer_category).filter(Boolean))];
  const statuses = [...new Set(drives.map(d => d.status).filter(Boolean))];
  const roleCategories = [...new Set(drives.map(d => d.role_category).filter(Boolean))];
  const marksScales = [...new Set(drives.map(d => d.min_overall_cgpa_scale).filter(Boolean))];
  const joiningTimelines = [...new Set(drives.map(d => d.joining_timeline).filter(Boolean))];
  
  console.log('\narrears_policy values:', arrearsPolicies.sort());
  console.log('drive_mode values:', driveModes.sort());
  console.log('drive_type values:', driveTypes.sort());
  console.log('offer_category values:', offerCategories.sort());
  console.log('status values:', statuses.sort());
  console.log('role_category values:', roleCategories.sort());
  console.log('marks_scale values:', marksScales.sort());
  console.log('joining_timeline values:', joiningTimelines.sort());
}

console.log('\n=== COMPARISON COMPLETE ===');
