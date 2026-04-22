const SUPABASE_URL = 'https://aymidyknappzejqrljdu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';

fetch(`${SUPABASE_URL}/rest/v1/contacts?select=data&limit=1`, {
    headers: { 'apikey': SUPABASE_ANON_KEY }
})
.then(r => r.json())
.then(rows => {
    if (!rows || rows.length === 0) {
        console.log('No contacts found.');
        return;
    }
    const keys = Object.keys(rows[0].data);
    const emptyKeys = keys.filter(k => k.includes('EMPTY') || k.startsWith('_'));
    console.log('Total keys:', keys.length);
    console.log('Empty keys:', emptyKeys);
    console.log('All keys:', keys);
})
.catch(err => {
    console.error('Error:', err.message);
});
