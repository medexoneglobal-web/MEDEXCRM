const fs = require('fs');
const path = require('path');

const chunksDir = path.join(__dirname, 'restore-chunks');
const files = fs.readdirSync(chunksDir).filter(f => f.endsWith('.sql'));

for (const file of files) {
  const filePath = path.join(chunksDir, file);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  
  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('INSERT INTO') && trimmed.endsWith(');')) {
      return line.replace(/\);\s*$/, ') ON CONFLICT DO NOTHING;');
    }
    return line;
  });
  
  fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
  console.log(`Fixed: ${file}`);
}

console.log('\nAll chunks updated with ON CONFLICT DO NOTHING');
