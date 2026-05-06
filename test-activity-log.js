const URL = 'https://aymidyknappzejqrljdu.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bWlkeWtuYXBwemVqcXJsamR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzgwODQsImV4cCI6MjA5MTg1NDA4NH0.zxVXVZogd1NNWyCs660XH6ZKK8jtHX4UeEP7fa57ArE';
async function test() {
  console.log('INSERT test...');
  let r = await fetch(URL+'/rest/v1/activity_log', {method:'POST', headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=representation'}, body:JSON.stringify({username:'test',module:'CRM',action_type:'DELETE',action_description:'Test'})});
  console.log('INSERT status:', r.status);
  let t = await r.text();
  console.log('INSERT response:', t);
  console.log('SELECT test...');
  r = await fetch(URL+'/rest/v1/activity_log?select=*&limit=3', {headers:{'apikey':KEY,'Authorization':'Bearer '+KEY}});
  console.log('SELECT status:', r.status);
  t = await r.text();
  console.log('SELECT response:', t);
}
test();