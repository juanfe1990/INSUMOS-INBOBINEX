const fs = require('fs');
const file = 'c:/Users/jubla/Desktop/Inbobinex/app/(admin)/admin/page.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    '<div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">',
    '<div className="flex items-center gap-1">'
);

fs.writeFileSync(file, content, 'utf8');
console.log('Opacity-0 removed from category buttons');

