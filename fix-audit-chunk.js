const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'restore-chunks', 'chunk-18-audit-log.sql');
let content = fs.readFileSync(filePath, 'utf8');

// Remove created_at from audit_log INSERT statements
// Pattern: INSERT INTO audit_log (contacts_id, action, changed_by, changed_at, old_data, new_data, changed_fields, created_at) VALUES
// Replace with: INSERT INTO audit_log (contacts_id, action, changed_by, changed_at, old_data, new_data, changed_fields) VALUES
content = content.replace(
  /INSERT INTO audit_log \(contacts_id, action, changed_by, changed_at, old_data, new_data, changed_fields, created_at\) VALUES/g,
  'INSERT INTO audit_log (contacts_id, action, changed_by, changed_at, old_data, new_data, changed_fields) VALUES'
);

// Remove the last value (created_at) from each VALUES clause
// The pattern is: , 'timestamp') ON CONFLICT DO NOTHING;
// We need to change it to: ) ON CONFLICT DO NOTHING;
content = content.replace(
  /, '2026-05-11 09:38:38'\) ON CONFLICT DO NOTHING;/g,
  ') ON CONFLICT DO NOTHING;'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed chunk-18-audit-log.sql');
