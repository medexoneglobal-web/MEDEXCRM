const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'restore-supabase-data.sql');
const outputDir = path.join(__dirname, 'restore-chunks');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const content = fs.readFileSync(inputFile, 'utf8');
const lines = content.split('\n');

const header = [];
const contacts = [];
const auditLog = [];
const users = [];
const accessRights = [];
const mandatoryFields = [];
const jobsheets = [];
const licenseKeys = [];
const footer = [];
const sequences = [];

let section = 'header';

for (const line of lines) {
  const trimmed = line.trim();
  
  if (trimmed.includes('-- Users')) section = 'users';
  else if (trimmed.includes('-- Access Rights')) section = 'rights';
  else if (trimmed.includes('-- Mandatory Fields')) section = 'fields';
  else if (trimmed.includes('-- Contacts (CRM Data)')) section = 'contacts';
  else if (trimmed.includes('-- Audit Log')) section = 'audit';
  else if (trimmed.includes('-- Jobsheets')) section = 'jobsheets';
  else if (trimmed.includes('-- License Key Data')) section = 'license';
  else if (trimmed.includes('-- Fix audit log')) { section = 'sequences'; sequences.push(line); continue; }
  else if (trimmed.includes('-- Reset sequences')) { section = 'sequences'; sequences.push(line); continue; }
  else if (trimmed === 'COMMIT;') { section = 'footer'; footer.push(line); continue; }
  else if (trimmed.includes('-- END OF RESTORATION')) { section = 'footer'; footer.push(line); continue; }
  else if (trimmed.includes('BEGIN;')) { header.push(line); continue; }
  else if (trimmed.includes('END OF MIGRATION') || trimmed.includes('DATA RESTORATION')) { header.push(line); continue; }
  else if (trimmed.startsWith('--') && trimmed.includes('-----')) {
    if (section !== 'header') {
      // section divider line
    }
  }
  
  if (section === 'sequences') {
    sequences.push(line);
    continue;
  }
  
  if (trimmed.startsWith('INSERT INTO contacts')) {
    contacts.push(line);
    section = 'contacts';
  } else if (trimmed.startsWith('INSERT INTO audit_log')) {
    auditLog.push(line);
    section = 'audit';
  } else if (trimmed.startsWith('INSERT INTO users')) {
    users.push(line);
    section = 'users';
  } else if (trimmed.startsWith('INSERT INTO access_rights')) {
    accessRights.push(line);
    section = 'rights';
  } else if (trimmed.startsWith('INSERT INTO mandatory_fields')) {
    mandatoryFields.push(line);
    section = 'fields';
  } else if (trimmed.startsWith('INSERT INTO jobsheets')) {
    jobsheets.push(line);
    section = 'jobsheets';
  } else if (trimmed.startsWith('INSERT INTO license_key_data')) {
    licenseKeys.push(line);
    section = 'license';
  } else if (section === 'header') {
    header.push(line);
  } else if (section === 'users') {
    if (trimmed) users.push(line);
  } else if (section === 'rights') {
    if (trimmed) accessRights.push(line);
  } else if (section === 'fields') {
    if (trimmed) mandatoryFields.push(line);
  } else if (section === 'contacts') {
    if (trimmed) contacts.push(line);
  } else if (section === 'audit') {
    if (trimmed) auditLog.push(line);
  } else if (section === 'jobsheets') {
    if (trimmed) jobsheets.push(line);
  } else if (section === 'license') {
    if (trimmed) licenseKeys.push(line);
  } else if (section === 'footer') {
    footer.push(line);
  }
}

// Clean up sequences - remove empty lines at start
const cleanSequences = sequences.filter(l => l.trim().startsWith('SELECT') || l.trim().startsWith('UPDATE') || l.trim().startsWith('--'));

// Write chunks
const chunkSize = 250; // contacts per chunk
let chunkNum = 1;

function writeChunk(name, lines, extraHeader) {
  const out = [];
  out.push('BEGIN;');
  if (extraHeader) out.push(...extraHeader);
  out.push(...lines);
  out.push('COMMIT;');
  const filePath = path.join(outputDir, `chunk-${String(chunkNum).padStart(2, '0')}-${name}.sql`);
  fs.writeFileSync(filePath, out.join('\n'), 'utf8');
  console.log(`Written ${filePath} (${lines.length} lines)`);
  chunkNum++;
}

// Chunk 1: Setup + Users + Access Rights + Mandatory Fields
const setupLines = [];
setupLines.push(...users.filter(l => l.trim()));
setupLines.push(...accessRights.filter(l => l.trim()));
setupLines.push(...mandatoryFields.filter(l => l.trim()));
writeChunk('setup', setupLines, []);

// Contacts in batches
for (let i = 0; i < contacts.length; i += chunkSize) {
  const batch = contacts.slice(i, i + chunkSize);
  writeChunk(`contacts-${i+1}-${Math.min(i+chunkSize, contacts.length)}`, batch.filter(l => l.trim()));
}

// Audit log chunk
if (auditLog.length > 0) {
  writeChunk('audit-log', auditLog.filter(l => l.trim()));
}

// Jobsheets chunk
if (jobsheets.length > 0) {
  writeChunk('jobsheets', jobsheets.filter(l => l.trim()));
}

// License keys chunk
if (licenseKeys.length > 0) {
  writeChunk('license-keys', licenseKeys.filter(l => l.trim()));
}

// Final chunk: fix audit log + sequences
const finalLines = [];
finalLines.push(...cleanSequences);
writeChunk('sequences', finalLines, []);

console.log(`\nTotal chunks: ${chunkNum - 1}`);
console.log(`Output directory: ${outputDir}`);
