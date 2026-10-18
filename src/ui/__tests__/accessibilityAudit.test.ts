import fs from 'fs';
import path from 'path';
import ts from 'typescript';

// A screen reader announces what a control is only if it is told. Every input and switch needs a label, every
// touchable a role, and every image a description (or an explicit "decorative").
const ROOT = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

function problems(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const names = new Set(node.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(source)));
      const spread = node.attributes.properties.some(ts.isJsxSpreadAttribute);
      const where = `${path.relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      if (!spread) {
        if ((tag === 'TextInput' || tag === 'Switch') && !names.has('accessibilityLabel')) found.push(`${where} ${tag} has no accessibilityLabel`);
        if ((tag === 'TouchableOpacity' || tag === 'Pressable') && !names.has('accessibilityRole')) found.push(`${where} ${tag} has no accessibilityRole`);
        if (tag === 'Image' && !names.has('accessibilityLabel') && !names.has('accessible')) found.push(`${where} Image has no accessibilityLabel`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('every input, switch, touchable and image tells a screen reader what it is', () => {
  const all = [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'src'))].flatMap(problems);

  expect(all).toEqual([]);
});
