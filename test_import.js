const fs = require('fs');

let content = fs.readFileSync('frontend/src/components/ConfigModal.jsx', 'utf8');

const match = content.match(/import \{([^}]+)\} from 'lucide-react'/);
if (match) {
  const imports = match[1].split(',').map(s => s.trim());
  console.log('Imports:', imports);
  console.log('Has XCircle?', imports.includes('XCircle'));
}
